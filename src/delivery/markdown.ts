import { writeFile, readFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface MarkdownInput {
  baseDir: string;
  date: string;
  content: string;
}

export async function writeMarkdownSummary(input: MarkdownInput): Promise<string> {
  const path = join(input.baseDir, `${input.date}.md`);
  await mkdir(dirname(path), { recursive: true });

  let existing = '';
  try {
    await access(path);
    existing = await readFile(path, 'utf-8');
  } catch {
    existing = '';
  }

  const separator = existing ? `\n\n---\n\n` : '';
  const next = `${existing}${separator}${input.content}\n`;
  await writeFile(path, next, 'utf-8');
  return path;
}
