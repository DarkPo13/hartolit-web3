import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

globalThis.React = React;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd().replaceAll("\\", "/") }, jsx: { runtime: "automatic" } });
const { Button } = await jiti.import("../components/ui/Button.tsx");

test("asChild buttons render one link with their label and optional icons inside it", () => {
  for (const icons of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(Button, {
      asChild: true,
      ...(icons ? { leadingIcon: React.createElement("svg", { "data-icon": "leading" }), trailingIcon: React.createElement("svg", { "data-icon": "trailing" }) } : {}),
    }, React.createElement("a", { href: "/feedback" }, "Leave feedback")));
    assert.match(html, /^<a /);
    assert.match(html, /href="\/feedback"/);
    assert.match(html, />.*Leave feedback.*<\/a>$/);
    assert.ok(!html.includes("<button"));
    if (icons) {
      assert.ok(html.indexOf('data-icon="leading"') < html.indexOf("Leave feedback"));
      assert.ok(html.indexOf('data-icon="trailing"') > html.indexOf("Leave feedback"));
    }
  }
});
