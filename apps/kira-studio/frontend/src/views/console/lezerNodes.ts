// P18 (v1.1) C3/C6: the DDL extractor (ddl.ts) and the alias/reference walk diagnostics and
// hovers both share (sqlRefs.ts) walk the same Lezer parse tree lang-sql's own dialects already
// produce (`dialect.language.parser.parse(text)`). `@lezer/common`'s real `SyntaxNode` type is not
// a direct dependency of this app (only a transitive one of @codemirror/lang-sql), and adding it
// as one just to name a type would be a new line in package.json for a phase whose own ground
// rules require zero new dependencies — so this interface is a deliberately narrow structural
// subset of the real SyntaxNode shape (name/from/to/firstChild/nextSibling), and every tree TS
// sees here is the genuine Lezer tree assigned to it with no cast.
export interface LNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly firstChild: LNode | null;
  readonly nextSibling: LNode | null;
}

export function childrenOf(node: LNode): LNode[] {
  const out: LNode[] = [];
  let c = node.firstChild;
  while (c) {
    out.push(c);
    c = c.nextSibling;
  }
  return out;
}

export function text(node: LNode, source: string): string {
  return source.slice(node.from, node.to);
}

const NAME_NODE_KINDS = new Set(['Identifier', 'QuotedIdentifier', 'Keyword']);

// F5.1: a column or table literally named `id`/`name` tokenises as a bare Keyword under
// Postgres's own 763-word keyword list (kw.includes('id')/('name') === true) — lang-sql's own
// sourceContext accepts Identifier/QuotedIdentifier/Keyword alike in a name position, and this
// extractor must too, or it silently drops the single most common column name in a real schema.
export function isNameNode(node: LNode): boolean {
  return NAME_NODE_KINDS.has(node.name);
}

export function unquotedName(node: LNode, source: string): string {
  const raw = text(node, source);
  if (node.name === 'QuotedIdentifier') {
    const q = raw[0];
    if (q === '"' || q === '`') {
      return raw.slice(1, -1).replaceAll(q + q, q);
    }
  }
  return raw;
}

// A CompositeIdentifier's own children alternate name '.' name ['.' name ...] — every
// non-punctuation child, in order, is one segment (F4's tree shape).
export function splitComposite(node: LNode, source: string): string[] {
  return childrenOf(node)
    .filter(isNameNode)
    .map((n) => unquotedName(n, source));
}

export function isKeyword(node: LNode | undefined, word: string, source: string): boolean {
  return !!node && node.name === 'Keyword' && text(node, source).toLowerCase() === word;
}

export function keywordText(node: LNode | undefined, source: string): string | undefined {
  return node?.name === 'Keyword' ? text(node, source).toLowerCase() : undefined;
}

// A tiny lookahead cursor over one statement's flat token list — every DDL statement shape D9
// understands, and every SELECT's FROM/JOIN clause sqlRefs.ts walks, is a linear scan over
// siblings with a handful of optional keywords, not a real recursive-descent grammar.
export class TokenCursor {
  i = 0;
  constructor(
    private readonly toks: readonly LNode[],
    private readonly source: string,
  ) {}

  peek(offset = 0): LNode | undefined {
    return this.toks[this.i + offset];
  }

  atKeyword(word: string, offset = 0): boolean {
    return isKeyword(this.peek(offset), word, this.source);
  }

  eatKeyword(word: string): boolean {
    if (this.atKeyword(word)) {
      this.i++;
      return true;
    }
    return false;
  }

  next(): LNode | undefined {
    return this.toks[this.i++];
  }

  done(): boolean {
    return this.i >= this.toks.length;
  }
}
