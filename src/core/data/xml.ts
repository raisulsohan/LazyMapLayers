// A small XML reader for answers such as a WMS GetCapabilities (D103): elements, attributes and text,
// with namespace prefixes dropped from names. Core has no DOM, so it reads the text itself. It does
// not validate and ignores the DOCTYPE, comments and processing instructions.

export type XmlElement = { name: string; attrs: Record<string, string>; children: XmlElement[]; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

const local = (name: string) => name.slice(name.indexOf(":") + 1);

/** The document's root element; throws on text that is not XML. */
export function parseXml(text: string): XmlElement {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const root: XmlElement = { name: "", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let at = 0;
  const fail = (why: string): never => {
    throw new Error(`not readable XML (${why} near character ${at})`);
  };
  while (at < source.length) {
    const open = source.indexOf("<", at);
    const top = stack[stack.length - 1];
    if (open < 0) {
      top.text += decodeEntities(source.slice(at));
      break;
    }
    if (open > at) top.text += decodeEntities(source.slice(at, open));
    at = open;
    if (source.startsWith("<!--", at)) {
      const end = source.indexOf("-->", at + 4);
      at = end < 0 ? fail("an unclosed comment") : end + 3;
    } else if (source.startsWith("<![CDATA[", at)) {
      const end = source.indexOf("]]>", at + 9);
      if (end < 0) fail("an unclosed CDATA section");
      top.text += source.slice(at + 9, end);
      at = end + 3;
    } else if (source.startsWith("<?", at)) {
      const end = source.indexOf("?>", at + 2);
      at = end < 0 ? fail("an unclosed processing instruction") : end + 2;
    } else if (source.startsWith("<!", at)) {
      // A DOCTYPE, perhaps with an internal subset in brackets.
      const bracket = source.indexOf("[", at);
      const close = source.indexOf(">", at);
      if (close < 0) fail("an unclosed declaration");
      if (bracket >= 0 && bracket < close) {
        const end = source.indexOf("]", bracket);
        const after = end < 0 ? -1 : source.indexOf(">", end);
        at = after < 0 ? fail("an unclosed DOCTYPE") : after + 1;
      } else at = close + 1;
    } else if (source[at + 1] === "/") {
      const end = source.indexOf(">", at);
      if (end < 0) fail("an unclosed end tag");
      const name = local(source.slice(at + 2, end).trim());
      if (stack.length < 2 || stack[stack.length - 1].name !== name) fail(`</${name}> closes nothing open`);
      stack.pop();
      at = end + 1;
    } else {
      // A start tag: find its end outside quoted values.
      let end = at + 1;
      let quote = "";
      for (; end < source.length; end++) {
        const c = source[end];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (end >= source.length) fail("an unclosed start tag");
      let inside = source.slice(at + 1, end);
      const empty = inside.endsWith("/");
      if (empty) inside = inside.slice(0, -1);
      const name = /^[^\s/>]+/.exec(inside)?.[0] ?? fail("a tag without a name");
      const element: XmlElement = { name: local(name), attrs: {}, children: [], text: "" };
      const attr = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      const rest = inside.slice(name.length);
      for (let m = attr.exec(rest); m; m = attr.exec(rest)) element.attrs[local(m[1])] = decodeEntities(m[3] ?? m[4] ?? "");
      top.children.push(element);
      if (!empty) stack.push(element);
      at = end + 1;
    }
  }
  if (stack.length > 1) fail(`<${stack[stack.length - 1].name}> is never closed`);
  const first = root.children[0];
  if (!first) fail("no element");
  return first;
}

/** The element's children with this (local) name, in any case. */
export const childrenNamed = (element: XmlElement | null | undefined, name: string): XmlElement[] => (element ? element.children.filter((c) => c.name.toLowerCase() === name.toLowerCase()) : []);
export const childNamed = (element: XmlElement | null | undefined, name: string): XmlElement | null => childrenNamed(element, name)[0] ?? null;
/** A child's text, trimmed ("" when there is none). */
export const childText = (element: XmlElement | null | undefined, name: string): string => childNamed(element, name)?.text.trim() ?? "";
/** Follows a path of child names. */
export const pathOf = (element: XmlElement | null | undefined, ...names: string[]): XmlElement | null => names.reduce<XmlElement | null>((at, name) => childNamed(at, name), element ?? null);
