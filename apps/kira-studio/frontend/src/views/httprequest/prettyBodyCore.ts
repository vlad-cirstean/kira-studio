import { beautifyJson, beautifyXml } from '../../beautify';

export type PrettyFormat = 'json' | 'xml';

export interface PrettyRequest {
  id: number;
  body: string;
  wantText: boolean;
}

export interface PrettyResult {
  format: PrettyFormat | null;
  text?: string;
}

/** One parse per body: detects the format and, when asked, returns the pretty text from that same parse. */
export function formatBody(body: string, wantText: boolean): PrettyResult {
  const json = beautifyJson(body, 'indented');
  if (json.ok) return wantText ? { format: 'json', text: json.text } : { format: 'json' };
  // The `<…>` bracket check mirrors celleditor/detect.ts's own detectXml gate: an XML parse alone
  // accepts plain text with no tags at all, so without it every plain-text body reports as XML.
  const t = body.trim();
  if (t.length === 0 || t[0] !== '<' || t[t.length - 1] !== '>') return { format: null };
  const xml = beautifyXml(body, 'indented');
  if (!xml.ok) return { format: null };
  return wantText ? { format: 'xml', text: xml.text } : { format: 'xml' };
}
