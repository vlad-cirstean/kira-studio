// Comment extraction and code-identity helper for scripts/commentsweep (Go does everything else).
//   bun scan.ts scan   stdin: one repo-relative path per line; stdout: one JSON line per file
//                      {file, error?, ranges: [{start, end, kind}]} with UTF-8 byte offsets, end exclusive
//   bun scan.ts check  stdin: JSON lines {file, before, after}; stdout: {file, ok, reason, ranges, rangesBefore}, ranges as "start,end,kind;..."
//                      ok when the code is identical once comments are stripped; ranges and rangesBefore are the comment ranges of the after and before files
import { readFileSync, writeSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  compileTemplate,
  parse as parseSfc,
  type SFCBlock,
  type SFCDescriptor,
} from '@vue/compiler-sfc';
import ts from 'typescript';

type Kind = 'line' | 'block' | 'template';
export type Range = { start: number; end: number; kind: Kind };

/** Maps UTF-16 indices of `text` to UTF-8 byte offsets. */
function byteMapper(text: string): (i: number) => number {
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) {
      ascii = false;
      break;
    }
  }
  if (ascii) return (i) => i;
  const off = new Int32Array(text.length + 1);
  let b = 0;
  for (let i = 0; i < text.length; i++) {
    off[i] = b;
    const c = text.charCodeAt(i);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c <= 0xdbff) b += 2;
    else if (c >= 0xdc00 && c <= 0xdfff) b += 2;
    else b += 3;
  }
  off[text.length] = b;
  return (i) => off[i];
}

function scriptKind(lang: string | undefined, name: string): ts.ScriptKind {
  const l = (lang ?? name.slice(name.lastIndexOf('.') + 1)).toLowerCase();
  switch (l) {
    case 'tsx':
      return ts.ScriptKind.TSX;
    case 'jsx':
      return ts.ScriptKind.JSX;
    case 'js':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function source(name: string, text: string, lang?: string): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, scriptKind(lang, name));
}

/** Every comment of a TS/JS text as UTF-16 [start, end) with its kind, found through the parsed token tree. */
function tsComments(
  name: string,
  text: string,
  lang?: string,
): { start: number; end: number; kind: Kind }[] {
  const sf = source(name, text, lang);
  const seen = new Map<number, { start: number; end: number; kind: Kind }>();
  const take = (ranges: ts.CommentRange[] | undefined) => {
    for (const r of ranges ?? []) {
      seen.set(r.pos, {
        start: r.pos,
        end: r.end,
        kind: r.kind === ts.SyntaxKind.SingleLineCommentTrivia ? 'line' : 'block',
      });
    }
  };
  const walk = (node: ts.Node) => {
    const kids = node.getChildren(sf);
    if (kids.length === 0) {
      const pos = node.getFullStart();
      take(ts.getLeadingCommentRanges(text, pos));
      take(ts.getTrailingCommentRanges(text, pos));
      return;
    }
    for (const k of kids) {
      if (k.kind >= ts.SyntaxKind.FirstJSDocNode && k.kind <= ts.SyntaxKind.LastJSDocNode) continue;
      walk(k);
    }
  };
  walk(sf);
  return [...seen.values()].sort((a, b) => a.start - b.start);
}

type Template = {
  type: number;
  loc: { start: { offset: number }; end: { offset: number } };
  children?: Template[];
};

function templateComments(node: Template, out: { start: number; end: number; kind: Kind }[]) {
  for (const c of node.children ?? []) {
    if (c.type === 3)
      out.push({ start: c.loc.start.offset, end: c.loc.end.offset, kind: 'template' });
    else if (c.children) templateComments(c, out);
  }
}

function sfc(name: string, text: string): SFCDescriptor {
  return parseSfc(text, { filename: name, templateParseOptions: { comments: true } }).descriptor;
}

function vueComments(name: string, text: string): { start: number; end: number; kind: Kind }[] {
  const d = sfc(name, text);
  const out: { start: number; end: number; kind: Kind }[] = [];
  for (const b of [d.script, d.scriptSetup]) {
    if (!b) continue;
    const base = b.loc.start.offset;
    for (const r of tsComments(`${name}.${b.lang ?? 'js'}`, b.content, b.lang))
      out.push({ ...r, start: r.start + base, end: r.end + base });
  }
  const t = d.template;
  if (t?.ast && !t.lang) templateComments(t.ast as unknown as Template, out);
  return out.sort((a, b) => a.start - b.start);
}

/** Comment ranges of one file as UTF-8 byte offsets. */
export function comments(name: string, text: string): Range[] {
  const raw = name.endsWith('.vue') ? vueComments(name, text) : tsComments(name, text);
  const map = byteMapper(text);
  return raw.map((r) => ({ start: map(r.start), end: map(r.end), kind: r.kind }));
}

function printTs(name: string, text: string, lang?: string): string {
  return ts.createPrinter({ removeComments: true }).printFile(source(name, text, lang));
}

const blockKey = (b: SFCBlock) => JSON.stringify([b.type, b.lang ?? '', b.src ?? '', b.attrs]);

function skeleton(text: string, d: SFCDescriptor): string {
  const blocks = [d.template, d.script, d.scriptSetup, ...d.styles, ...d.customBlocks].filter(
    (b): b is SFCBlock => !!b,
  );
  blocks.sort((a, b) => a.loc.start.offset - b.loc.start.offset);
  let out = '';
  let at = 0;
  for (const b of blocks) {
    out += text.slice(at, b.loc.start.offset);
    at = b.loc.end.offset;
  }
  return out + text.slice(at);
}

/** Empty string when the code of `before` and `after` matches, otherwise the first difference found. */
export function codeDiff(name: string, before: string, after: string): string {
  if (!name.endsWith('.vue'))
    return printTs(name, before) === printTs(name, after) ? '' : 'printed code differs';
  const a = sfc(name, before);
  const b = sfc(name, after);
  if (skeleton(before, a) !== skeleton(after, b)) return 'outside block content differs';
  const pick = (d: SFCDescriptor) =>
    [d.template, d.script, d.scriptSetup, ...d.styles, ...d.customBlocks].filter(
      (x): x is SFCBlock => !!x,
    );
  const ba = pick(a);
  const bb = pick(b);
  if (ba.length !== bb.length || ba.some((x, i) => blockKey(x) !== blockKey(bb[i])))
    return 'block list differs';
  for (const [i, x] of ba.entries()) {
    const y = bb[i];
    if (x === a.script || x === a.scriptSetup) {
      if (
        printTs(`${name}.${x.lang ?? 'js'}`, x.content, x.lang) !==
        printTs(`${name}.${y.lang ?? 'js'}`, y.content, y.lang)
      )
        return `${x.type} code differs`;
    } else if (x === a.template) {
      if (x.lang) {
        if (x.content !== y.content) return 'template differs';
        continue;
      }
      const compile = (content: string) =>
        compileTemplate({
          source: content,
          filename: name,
          id: 'commentsweep',
          compilerOptions: { comments: false },
        });
      const ca = compile(x.content);
      const cb = compile(y.content);
      if (ca.code !== cb.code || ca.errors.length !== cb.errors.length)
        return 'template code differs';
    } else if (x.content !== y.content) {
      return `${x.type} block differs`;
    }
  }
  return '';
}

/** Writes one JSON line synchronously; console.log into a pipe loses output past the 64 KiB pipe buffer. */
function emit(v: unknown) {
  const buf = Buffer.from(`${JSON.stringify(v)}\n`);
  let off = 0;
  while (off < buf.length) {
    try {
      off += writeSync(1, buf, off);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EAGAIN') throw e;
    }
  }
}

const compact = (rs: Range[]) => rs.map((r) => `${r.start},${r.end},${r.kind[0]}`).join(';');

async function main(mode: string) {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (mode === 'scan') {
      const file = line.trim();
      try {
        emit({ file, ranges: comments(file, readFileSync(file, 'utf8')) });
      } catch (e) {
        emit({ file, error: String(e), ranges: [] });
      }
    } else if (mode === 'check') {
      const { file, before, after } = JSON.parse(line) as {
        file: string;
        before: string;
        after: string;
      };
      try {
        const reason = codeDiff(file, before, after);
        const ok = reason === '';
        emit({
          file,
          ok,
          reason,
          ranges: ok ? compact(comments(file, after)) : '',
          rangesBefore: ok ? compact(comments(file, before)) : '',
        });
      } catch (e) {
        emit({ file, ok: false, reason: String(e), ranges: '', rangesBefore: '' });
      }
    }
  }
}

if (import.meta.main) await main(process.argv[2] ?? '');
