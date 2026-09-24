// Where raw files are archived: an S3-compatible bucket (R2 in production), or
// data/raw/ on disk for local runs, so local runs never write to the real archive.

import { S3Client } from "bun";

export type RawStore = {
  /** Shown in logs. */
  name: string;
  write: (key: string, body: Uint8Array) => Promise<void>;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function localStore(): RawStore {
  const root = new URL("../../data/raw/", import.meta.url).pathname;
  return {
    name: root,
    write: async (key, body) => {
      await Bun.write(root + key, body);
    },
  };
}

/** Credentials are passed explicitly, so Bun never falls back to unrelated AWS_* variables. */
export function bucketStore(): RawStore {
  const bucket = env("S3_BUCKET");
  const client = new S3Client({
    endpoint: env("S3_ENDPOINT"),
    bucket,
    accessKeyId: env("S3_ACCESS_KEY_ID"),
    secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
  });
  return {
    name: `s3://${bucket}`,
    write: async (key, body) => {
      await client.write(key, body, { type: "application/gzip" });
    },
  };
}
