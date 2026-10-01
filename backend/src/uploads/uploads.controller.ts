import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { v2 as cloudinary } from 'cloudinary';

/**
 * Images go to Cloudinary through the backend, so the API secret never reaches the browser.
 * Open to the public because school registration uploads a logo before anyone has an account.
 */
@Controller('uploads')
export class UploadsController {
  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async image(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose an image file (max 2 MB).');
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) {
      throw new BadRequestException('Only PNG, JPG, WEBP or GIF images are allowed.');
    }
    // Reads CLOUDINARY_URL from the environment automatically.
    const url = await new Promise<string>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream({ folder: 'sncmt', resource_type: 'image' }, (err, result) => {
          if (err || !result) return reject(err ?? new Error('Upload failed'));
          resolve(result.secure_url);
        })
        .end(file.buffer);
    });
    return { url };
  }
}
