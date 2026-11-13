import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { callSTT } from '../llm/llm2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));




export async function transcribe(req) {
  /**
   * @register_router transcribe
   * @method POST
   * @upload file 1 25mb memory
   */
  try {
    const file = req.file;
    if (!file) {
      return { status: 400, data: { error: 'Nenhum áudio enviado' } };
    }

    const projectRoot = path.resolve(__dirname, '../../..');
    const uploadDir = path.join(projectRoot, 'uploads');
    await mkdir(uploadDir, { recursive: true });

    const safeName = (file.originalname || 'audio.webm').replace(/[^\w.\-]/g, '_');
    const filePath = path.join(uploadDir, `stt_${Date.now()}_${safeName}`);
    await writeFile(filePath, file.buffer);

    const language = String(req.body?.language || 'pt').slice(0, 5);
    const result = await callSTT({
      model: process.env.AGENT_STT_MODEL || 'openai/whisper-large-v3-turbo',
      audioPath: filePath,
      language,
    });
    return { status: 200, data: { ...result, text: String(result?.text || '').trim(), language } };
  } catch (e) {
    return { status: 500, data: { error: e.message } };
  }
}
