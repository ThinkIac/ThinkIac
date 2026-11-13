import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { UploadValidationError, validateUpload } from './upload_validation.js';
import { canRunOcr, recognizeImageText } from './ocr.js';


const __filename = fileURLToPath(import.meta.url);


const __dirname = path.dirname(__filename);

async function persistUpload(uploadDir, extension, buffer, makeId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const storedName = `${makeId()}${extension}`;
    const filePath = path.join(uploadDir, storedName);
    try {
      await writeFile(filePath, buffer, { flag: 'wx' });
      return { storedName, filePath };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Não foi possível gerar um nome de upload exclusivo');
}

export async function uploadFile(req, options = {}) {
  /**
   * @register_router upload
   * @method POST
   * @upload file 1 50mb memory
   */

  try {
    const file = req.file;

    if (!file) {
      return {
        status: 400,
        data: { error: 'Nenhum arquivo enviado' },
      };
    }

    /**
     * Estrutura esperada:
     *
     * /thinkiac
     *   ├── uploads
     *   └── packages
     *       └── agent
     *           └── routes
     *               └── upload.js
     *
     * routes -> agent
     * agent -> packages
     * packages -> thinkiac
     */
    const projectRoot = path.resolve(__dirname, '../../..');

    
    const uploadDir = options.uploadDir || path.join(projectRoot, 'uploads');

    const checked = validateUpload(file);

    
    await mkdir(uploadDir, { recursive: true });

    const { storedName, filePath } = await persistUpload(
      uploadDir, checked.extension, file.buffer, options.randomUUID || randomUUID,
    );

    const ocr = checked.isImage && canRunOcr(checked.mimetype)
      ? await (options.recognizeImageText || recognizeImageText)(filePath, options.ocrOptions)
      : { text: '', status: 'skipped' };

    const result = {
      name: checked.name,
      filename: storedName,
      path: filePath,
      mimetype: checked.mimetype,
      size: file.buffer.length,
      isImage: checked.isImage,
      isText: checked.isText,
      base64: checked.isImage ? `data:${checked.mimetype};base64,${file.buffer.toString('base64')}` : null,
      textContent: checked.textContent,
      ocrText: ocr.text || null,
      ocrStatus: ocr.status,
      sessionId: req.body?.sessionId || undefined,
    };

    
    if (options.dispatchEvent !== null) {
      try {
        const dispatch = options.dispatchEvent || (await import('logos')).dispatchEvent;
        await dispatch('file:uploaded', result);
      } catch {
        
      }
    }

    return {
      status: 200,
      data: result,
    };
  } catch (e) {
    if (e instanceof UploadValidationError) {
      return { status: e.status, data: { error: e.message } };
    }
    console.error('UPLOAD ERROR:', e);

    return {
      status: 500,
      data: {
        error: e.message,
      },
    };
  }
}
