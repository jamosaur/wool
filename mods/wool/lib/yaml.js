// A strict reader for the small part of YAML that wool's config files use:
// block maps, block lists, plain and quoted scalars, literal (|) and folded
// (>) block scalars, booleans, numbers, null, comments, and the empty flow
// collections `[]` and `{}`. Anything else is rejected with a line number
// rather than guessed at.

export class YamlError extends Error {
  constructor(message, line) {
    super(`line ${line}: ${message}`);
    this.name = "YamlError";
    this.line = line;
    this.reason = message;
  }
}

const KEY = /^([^\s"'#&*!|>\[\]{},?:%@`-][^:]*?|-[^\s:][^:]*?)[ ]*:(?=\s|$)/;
// A block scalar header: | or >, an optional chomping indicator, a comment.
const BLOCK_HEADER = /^([|>])([-+]?)(?:\s+#.*)?$/;

export function parseYaml(text) {
  const lines = tokenize(String(text));
  if (lines.length === 0) return null;
  const state = { lines, i: 0 };
  const first = lines[0];
  const value = parseBlock(state, first.indent);
  if (state.i < lines.length) {
    const l = lines[state.i];
    throw new YamlError("indentation doesn't match any open block", l.line);
  }
  return value;
}

function tokenize(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out = [];
  const raw = text.split(/\r?\n/);
  for (let n = 0; n < raw.length; n++) {
    const line = n + 1;
    const s = raw[n];
    const lead = /^[ \t]*/.exec(s)[0];
    const rest = s.slice(lead.length);
    if (rest === "" || rest.startsWith("#")) {
      if (lead.includes("\t") && rest !== "") throw new YamlError("tabs can't indent YAML; use spaces", line);
      continue;
    }
    if (lead.includes("\t")) throw new YamlError("tabs can't indent YAML; use spaces", line);
    if (lead === "" && /^---(\s|$)/.test(rest)) {
      if (out.length > 0) throw new YamlError("only one YAML document is supported (found ---)", line);
      if (rest.slice(3).trim() !== "" && !rest.slice(3).trim().startsWith("#")) {
        throw new YamlError("content after --- isn't supported", line);
      }
      continue;
    }
    if (lead === "" && /^\.\.\.(\s|$)/.test(rest)) throw new YamlError("document end markers (...) aren't supported", line);
    const token = { indent: lead.length, text: rest.replace(/\s+$/, ""), line };
    const header = blockHeader(token.text, line);
    if (header) {
      // The lines that follow are the scalar's text, not YAML: comments,
      // blank lines and tabs in them are kept.
      const block = readBlockScalar(raw, n + 1, lead.length + header.column, header);
      token.block = block.value;
      n = block.next - 1;
    }
    out.push(token);
  }
  return out;
}

// Finds a block scalar header that ends a "key:", "- " or "- key:" line and
// returns the column of the node that owns it (the text must be indented past
// it), the style and the chomping indicator.
function blockHeader(text, line) {
  let column = 0;
  let owner = 0;
  let rest = text;
  while (isListItem(rest)) {
    const content = rest.slice(1).trimStart();
    owner = column;
    column += rest.length - content.length;
    rest = content;
  }
  const m = KEY.exec(rest);
  if (m) {
    owner = column;
    rest = rest.slice(m[0].length).trim();
  } else if (rest === text) {
    return null;
  }
  if (/^[|>][-+]?[0-9]|^[|>][0-9]/.test(rest)) {
    throw new YamlError("block scalar indentation indicators (|2) aren't supported; indent the text instead", line);
  }
  const h = BLOCK_HEADER.exec(rest);
  return h ? { column: owner, style: h[1], chomp: h[2] } : null;
}

function readBlockScalar(raw, start, parent, header) {
  const lines = [];
  let indent = null;
  let n = start;
  for (; n < raw.length; n++) {
    const s = raw[n];
    const spaces = /^ */.exec(s)[0].length;
    if (s.trim() === "") {
      lines.push("");
      continue;
    }
    if (indent === null) {
      if (spaces <= parent) break;
      indent = spaces;
    }
    if (spaces < indent) {
      if (spaces > parent) throw new YamlError("this line is indented less than the block text above it", n + 1);
      break;
    }
    lines.push(s.slice(indent));
  }
  // Blank lines after the text belong to whatever comes next, not the scalar.
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  const trailing = lines.length - end;
  return { value: blockValue(lines.slice(0, end), trailing, header), next: n };
}

function blockValue(lines, trailing, { style, chomp }) {
  let text;
  if (style === "|") {
    text = lines.join("\n");
  } else {
    // Folded: a single line break between two ordinary lines becomes a space;
    // blank lines and more-indented lines keep their line breaks.
    text = "";
    let prev = null;
    let empty = 0;
    for (const l of lines) {
      if (l === "") {
        empty++;
        continue;
      }
      const more = /^[ \t]/.test(l);
      if (prev === null) text += "\n".repeat(empty);
      else if (prev === "text" && !more) text += empty === 0 ? " " : "\n".repeat(empty);
      else text += "\n".repeat(empty + 1);
      text += l;
      prev = more ? "more" : "text";
      empty = 0;
    }
  }
  if (chomp === "-") return text;
  if (chomp === "+") return text + "\n".repeat((lines.length > 0 ? 1 : 0) + trailing);
  return lines.length > 0 ? text + "\n" : "";
}

function isListItem(text) {
  return text === "-" || text.startsWith("- ");
}

function parseBlock(state, indent) {
  const l = state.lines[state.i];
  if (isListItem(l.text)) return parseList(state, indent);
  if (KEY.test(l.text) || l.text.startsWith("<<")) return parseMap(state, indent);
  // A lone scalar is only allowed as the whole document.
  if (state.lines.length === 1) {
    state.i++;
    return parseScalar(l.text, l.line);
  }
  throw new YamlError(`expected "key: value" or "- item", found "${l.text}"`, l.line);
}

function parseMap(state, indent) {
  const map = {};
  const { lines } = state;
  while (state.i < lines.length) {
    const l = lines[state.i];
    if (l.indent < indent) break;
    if (l.indent > indent) throw new YamlError("indentation doesn't match the lines above", l.line);
    if (isListItem(l.text)) throw new YamlError("a list item can't appear among a map's keys", l.line);
    if (l.text.startsWith("<<")) throw new YamlError("merge keys (<<) aren't supported", l.line);
    const m = KEY.exec(l.text);
    if (!m) throw new YamlError(`expected "key: value", found "${l.text}"`, l.line);
    const key = m[1].trim();
    if (Object.prototype.hasOwnProperty.call(map, key)) throw new YamlError(`duplicate key "${key}"`, l.line);
    let rest = l.text.slice(m[0].length).trim();
    if (rest.startsWith("#")) rest = "";
    state.i++;
    if (l.block !== undefined) {
      map[key] = l.block;
      continue;
    }
    if (rest !== "") {
      map[key] = parseScalar(rest, l.line);
      continue;
    }
    const next = lines[state.i];
    if (next && next.indent > indent) {
      map[key] = parseBlock(state, next.indent);
    } else if (next && next.indent === indent && isListItem(next.text)) {
      map[key] = parseList(state, indent);
    } else {
      map[key] = null;
    }
  }
  return map;
}

function parseList(state, indent) {
  const list = [];
  const { lines } = state;
  while (state.i < lines.length) {
    const l = lines[state.i];
    if (l.indent < indent) break;
    if (l.indent > indent) throw new YamlError("indentation doesn't match the lines above", l.line);
    if (!isListItem(l.text)) break;
    const after = l.text.slice(1);
    const content = after.trimStart();
    if (content === "" || content.startsWith("#")) {
      state.i++;
      const next = lines[state.i];
      list.push(next && next.indent > indent ? parseBlock(state, next.indent) : null);
      continue;
    }
    const offset = indent + 1 + (after.length - content.length);
    if (isListItem(content) || KEY.test(content) || content.startsWith("<<")) {
      // The item's first line continues as a nested block at the content's column.
      lines[state.i] = { ...l, indent: offset, text: content };
      list.push(parseBlock(state, offset));
      continue;
    }
    state.i++;
    list.push(l.block !== undefined ? l.block : parseScalar(content, l.line));
  }
  return list;
}

function parseScalar(text, line) {
  const c = text[0];
  if (c === '"' || c === "'") {
    const { value, end } = c === '"' ? doubleQuoted(text, line) : singleQuoted(text, line);
    const rest = text.slice(end);
    if (rest.trim() !== "" && !/^\s+#/.test(rest)) {
      throw new YamlError(`unexpected text after the closing quote: "${rest.trim()}"`, line);
    }
    return value;
  }
  if (c === "[" || c === "{") {
    const close = c === "[" ? "\\]" : "\\}";
    if (new RegExp(`^\\${c}\\s*${close}(\\s+#.*)?$`).test(text)) return c === "[" ? [] : {};
    throw new YamlError(`flow ${c === "[" ? "lists ([a, b])" : "maps ({a: b})"} aren't supported; use block style`, line);
  }
  if (c === "|" || c === ">") throw new YamlError(`unsupported block scalar header "${text}"; use | or > with an optional - or +`, line);
  if (c === "&") throw new YamlError("anchors (&) aren't supported", line);
  if (c === "*") throw new YamlError("aliases (*) aren't supported", line);
  if (c === "!") throw new YamlError("tags (!) aren't supported", line);
  if (c === "%" || c === "@" || c === "`") throw new YamlError(`a plain value can't start with "${c}"; quote it`, line);
  const hash = text.search(/\s#/);
  const plain = (hash === -1 ? text : text.slice(0, hash)).trim();
  if (/:(\s|$)/.test(plain)) throw new YamlError(`unexpected ": " in a value; quote it: "${plain}"`, line);
  if (plain === "true") return true;
  if (plain === "false") return false;
  if (plain === "null" || plain === "~" || plain === "") return null;
  if (/^-?\d+$/.test(plain)) return Number(plain);
  if (/^-?\d+\.\d+$/.test(plain)) return Number(plain);
  return plain;
}

const ESCAPES = { '"': '"', "\\": "\\", n: "\n", t: "\t", "/": "/" };

function doubleQuoted(text, line) {
  let value = "";
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') return { value, end: i + 1 };
    if (ch === "\\") {
      const e = text[i + 1];
      if (!(e in ESCAPES)) throw new YamlError(`unsupported escape "\\${e ?? ""}" in a double-quoted string`, line);
      value += ESCAPES[e];
      i++;
      continue;
    }
    value += ch;
  }
  throw new YamlError("a double-quoted string isn't closed on this line", line);
}

function singleQuoted(text, line) {
  let value = "";
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      if (text[i + 1] === "'") {
        value += "'";
        i++;
        continue;
      }
      return { value, end: i + 1 };
    }
    value += ch;
  }
  throw new YamlError("a single-quoted string isn't closed on this line", line);
}
