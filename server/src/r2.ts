import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

// Built on first use, not at import: the test suite runs with no R2_* vars set,
// and constructing at module scope would break every test in this repo that
// merely imports a route file.
//
// ponytail: the cost of that is a bad R2_* value in prod failing at the first
// upload rather than at boot — tracked as I3/I4 in docs/BACKLOG.md, the fix
// being a presence check of these four vars at startup.
let client: S3Client | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — image storage is unconfigured`);
  return value;
}

function r2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}

/** An image's location is derived, never stored: a shape needs no `src` field,
 *  and the server never accepts a key from the client. Both ids are
 *  crypto.randomUUID()s, and the board id is always the one that already
 *  passed a board_members check. */
export function imageKey(boardId: string, shapeId: string): string {
  return `boards/${boardId}/images/${shapeId}`;
}

function boardPrefix(boardId: string): string {
  return `boards/${boardId}/images/`;
}

export async function putImage(
  boardId: string,
  shapeId: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await r2().send(
    new PutObjectCommand({
      Bucket: requireEnv("R2_BUCKET"),
      Key: imageKey(boardId, shapeId),
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** Null when the object doesn't exist — a shape whose upload never landed, or
 *  one carried into a duplicated board before its objects were copied. */
export async function getImage(
  boardId: string,
  shapeId: string,
): Promise<{ body: Readable; contentType: string } | null> {
  try {
    const result = await r2().send(
      new GetObjectCommand({ Bucket: requireEnv("R2_BUCKET"), Key: imageKey(boardId, shapeId) }),
    );
    if (!result.Body) return null;
    return {
      body: result.Body as Readable,
      contentType: result.ContentType ?? "application/octet-stream",
    };
  } catch (err) {
    if (err instanceof Error && (err.name === "NoSuchKey" || err.name === "NotFound")) return null;
    throw err;
  }
}

async function listBoardKeys(boardId: string): Promise<string[]> {
  const bucket = requireEnv("R2_BUCKET");
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await r2().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: boardPrefix(boardId),
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

export async function deleteBoardImages(boardId: string): Promise<void> {
  const keys = await listBoardKeys(boardId);
  if (keys.length === 0) return;
  const bucket = requireEnv("R2_BUCKET");
  // DeleteObjects caps at 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    await r2().send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
      }),
    );
  }
}

/** Duplicating a board copies the Yjs snapshot, so the copy holds the same
 *  shape ids — and because keys are derived from (boardId, shapeId), those
 *  resolve under the new board's prefix. Without this the duplicate renders
 *  empty images. Copies happen inside R2; no bytes pass through this process. */
export async function copyBoardImages(fromBoardId: string, toBoardId: string): Promise<void> {
  const bucket = requireEnv("R2_BUCKET");
  const keys = await listBoardKeys(fromBoardId);
  for (const key of keys) {
    const shapeId = key.slice(boardPrefix(fromBoardId).length);
    await r2().send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: encodeURI(`${bucket}/${key}`),
        Key: imageKey(toBoardId, shapeId),
      }),
    );
  }
}
