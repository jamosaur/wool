import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYaml, YamlError } from "../mods/wool/lib/yaml.js";

function rejects(text, line, pattern) {
  assert.throws(() => parseYaml(text), (e) => {
    assert.ok(e instanceof YamlError, `expected YamlError, got ${e}`);
    if (line !== undefined) assert.equal(e.line, line, e.message);
    if (pattern) assert.match(e.message, pattern);
    return true;
  });
}

test("parses the herdr-dog example", () => {
  const text = `version: 1
worktrees:
  setup:
    - run: cp "$HERDR_MAIN_WORKTREE/.env" .env
    - name: Install dependencies
      run: pnpm install
    - name: Seed database
      run: pnpm db:seed
      env:
        NODE_ENV: development
`;
  assert.deepEqual(parseYaml(text), {
    version: 1,
    worktrees: {
      setup: [
        { run: 'cp "$HERDR_MAIN_WORKTREE/.env" .env' },
        { name: "Install dependencies", run: "pnpm install" },
        { name: "Seed database", run: "pnpm db:seed", env: { NODE_ENV: "development" } },
      ],
    },
  });
});

test("parses the quiz workspace example", () => {
  const text = `# .herdr/workspace.yml.dist
version: 1
tabs:
  - title: Agent
    panes:
      - agent: default
  - title: Shell
    panes:
      - title: shell
  - title: Dev
    panes:
      - command: composer run dev
        setup: true
`;
  assert.deepEqual(parseYaml(text), {
    version: 1,
    tabs: [
      { title: "Agent", panes: [{ agent: "default" }] },
      { title: "Shell", panes: [{ title: "shell" }] },
      { title: "Dev", panes: [{ command: "composer run dev", setup: true }] },
    ],
  });
});

test("parses lists indented at their key's level", () => {
  assert.deepEqual(parseYaml("a:\n- x\n- y\nb: 2\n"), { a: ["x", "y"], b: 2 });
});

test("strips trailing comments but not # inside quotes", () => {
  assert.deepEqual(parseYaml('a: "x # y" # c\n'), { a: "x # y" });
  assert.deepEqual(parseYaml("b: 'p # q'   # c\nc: v#notacomment\n"), { b: "p # q", c: "v#notacomment" });
});

test("accepts CRLF and a BOM", () => {
  assert.deepEqual(parseYaml("\uFEFFa: 1\r\nb: two\r\n"), { a: 1, b: "two" });
});

test("keeps numeric-looking strings when quoted", () => {
  assert.deepEqual(parseYaml('PORT: "3000"\n'), { PORT: "3000" });
  assert.deepEqual(parseYaml("PORT: 3000\n"), { PORT: 3000 });
  assert.deepEqual(parseYaml("size: 0.3\nneg: -2\n"), { size: 0.3, neg: -2 });
});

test("reads booleans, null and quoted escapes", () => {
  assert.deepEqual(parseYaml("a: true\nb: false\nc: null\nd: ~\ne:\n"), { a: true, b: false, c: null, d: null, e: null });
  assert.deepEqual(parseYaml('a: "q\\"x\\\\y\\nz\\t"\nb: \'it\'\'s\'\n'), { a: 'q"x\\y\nz\t', b: "it's" });
});

test("empty flow collections", () => {
  assert.deepEqual(parseYaml("setup: []\nenv: {}\n"), { setup: [], env: {} });
});

test("an empty document is null", () => {
  assert.equal(parseYaml("# only a comment\n\n"), null);
});

test("rejects tab indentation", () => rejects("a:\n\tb: 1\n", 2, /tab/i));
test("rejects duplicate keys", () => rejects("a: 1\nb: 2\na: 3\n", 3, /duplicate/i));
test("rejects aliases", () => rejects("a: *x\n", 1));
test("rejects anchors", () => rejects("a: &x 1\n", 1));
test("rejects merge keys", () => rejects("a:\n  <<: *x\n", 2));
test("rejects a second document", () => rejects("a: 1\n---\nb: 2\n", 2));
test("rejects flow lists with content", () => rejects("a: [a, b]\n", 1));
test("rejects flow maps with content", () => rejects("a: {b: 1}\n", 1));
test("rejects inconsistent indentation", () => rejects("a:\n    b: 1\n  c: 2\n", 3));
test("rejects an unterminated quote", () => rejects('a: "x\n', 1));
test("rejects text after a closing quote", () => rejects('a: "x" y\n', 1));

test("literal block scalars keep lines, comments, blank lines and tabs", () => {
  const text = `setup:
  - name: Ports
    run: |
      # claim ports
      a=1

      printf '%s\\t%s' "$a" b
    env:
      X: "1"
  - run: echo next
`;
  assert.deepEqual(parseYaml(text), {
    setup: [
      { name: "Ports", run: "# claim ports\na=1\n\nprintf '%s\\t%s' \"$a\" b\n", env: { X: "1" } },
      { run: "echo next" },
    ],
  });
  assert.deepEqual(parseYaml("a: |\n  x\n  \ty\nb: 2\n"), { a: "x\n\ty\n", b: 2 });
});

test("block scalars as list items and nested deeper", () => {
  assert.deepEqual(parseYaml("- |\n  one\n  two\n- three\n"), ["one\ntwo\n", "three"]);
  assert.deepEqual(parseYaml("a:\n  - b: >\n      x\n      y\n    c: 1\n"), { a: [{ b: "x y\n", c: 1 }] });
  assert.deepEqual(parseYaml("a: |\n      deep\n        deeper\nb: 1\n"), { a: "deep\n  deeper\n", b: 1 });
});

test("block scalar chomping", () => {
  assert.deepEqual(parseYaml("a: |\n  x\n\n\nb: 1\n"), { a: "x\n", b: 1 });
  assert.deepEqual(parseYaml("a: |-\n  x\n\nb: 1\n"), { a: "x", b: 1 });
  assert.deepEqual(parseYaml("a: |+\n  x\n\n\nb: 1\n"), { a: "x\n\n\n", b: 1 });
  assert.deepEqual(parseYaml("a: >-\n  x\n  y\n"), { a: "x y" });
  assert.deepEqual(parseYaml("a: | # a comment\n  x\n"), { a: "x\n" });
});

test("folded block scalars", () => {
  assert.deepEqual(parseYaml("a: >\n  one\n  two\n\n  three\n    code\n  four\n"), { a: "one two\nthree\n  code\nfour\n" });
});

test("an empty block scalar", () => {
  assert.deepEqual(parseYaml("a: |\nb: 1\n"), { a: "", b: 1 });
});

test("a block scalar's text must be indented past its key", () => {
  rejects("a:\n  b: |\n  x\n", 3, /expected/);
  rejects("a: |\n    x\n  y\n", 3, /indented less/);
});
test("rejects block scalar indentation indicators", () => rejects("run: |2\n  echo hi\n", 1, /indentation indicator/));
test("rejects unknown block scalar headers", () => rejects("run: |x\n  echo hi\n", 1, /block scalar/));
test("quoted pipes aren't block scalars", () => {
  assert.deepEqual(parseYaml('a: "|"\nb: \'>\'\n'), { a: "|", b: ">" });
});
