import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const s3 = new S3Client({ region: process.env.AWS_REGION });

export function presignUpload(bucket: string, key: string, contentType: string) {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: 900 });
}

export function presignDownload(bucket: string, key: string) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 900 });
}
