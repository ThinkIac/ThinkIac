import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'


const execFileAsync = promisify(execFile)

export async function d2Render(req) {
    /**
     * @register_router d2/render
     * @method POST
     */
    const { source, theme = 0, layout = 'dagre', width = 0, height = 0, pad = 100 } = req.body ?? {}
    
    if (!source || typeof source !== 'string') {
        return { status: 400, data: { error: '`source` (string D2) é obrigatório' } }
    }

    let tmpDir = ''

    try {
        
        tmpDir = await fs.mkdtemp(join(tmpdir(), 'd2-'))
        const inputPath = join(tmpDir, 'diagram.d2')
        const outputPath = join(tmpDir, 'diagram.svg')

        await fs.writeFile(inputPath, source, 'utf-8')

        
        const args = [
            '--layout', String(layout),
            '--theme', String(theme),
            '--pad', String(pad),
        ]
        if (width > 0) args.push('--width', String(width))
        if (height > 0) args.push('--height', String(height))

        args.push(inputPath, outputPath)

        
        await execFileAsync('/usr/local/bin/d2', args, {
            timeout: 15000,
            cwd: tmpDir,
        })

        
        const svg = await fs.readFile(outputPath, 'utf-8')
        
        return { data: { svg, format: 'svg' } }

    } catch (e) {
        
        const stderr = e.stderr?.toString() || e.message || 'Erro desconhecido ao renderizar D2'
        const isSyntaxError = stderr.includes('d2') || stderr.includes('compile') || stderr.includes('error')
        
        return {
            status: 422,
            data: {
                error: isSyntaxError ? stderr : 'Falha ao renderizar diagrama D2',
                detail: stderr
            }
        }
    } finally {
        
        if (tmpDir) {
            try {
                
                
                await fs.rm(tmpDir, { recursive: true, force: true })
            } catch { /* silent cleanup */ }
        }
    }
}
