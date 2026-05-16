import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { v4 as uuid } from 'uuid';

@Injectable()
export class StorageService {
  private s3: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = process.env.AWS_S3_BUCKET!;

    this.s3 = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
    const fileKey = `${folder}/${uuid()}-${file.originalname}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: fileKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return `https://${this.bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
  }

  /**
   * Deletes a file from S3 given its full URL.
   * Institutional cleanup for orphaned KYC documents.
   */
  async deleteFile(fileUrl: string): Promise<void> {
    if (!fileUrl || fileUrl === 'pending') return;

    try {
      // Extract the key: everything after the bucket/region part of the URL
      // Example URL: https://my-bucket.s3.us-east-1.amazonaws.com/kyc/ids/abc-id.jpg
      const urlParts = fileUrl.split('.amazonaws.com/');
      if (urlParts.length < 2) return;
      const key = urlParts[1];

      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      console.log(`[StorageService] Cleaned up orphaned file: ${key}`);
    } catch (error) {
      console.error(
        `[StorageService] Failed to delete file: ${fileUrl}`,
        error,
      );
      // We do not throw here to prevent obscuring the primary registration error
    }
  }
}
