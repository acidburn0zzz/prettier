import assert from "node:assert";
import isNonEmptyArray from "../../utils/is-non-empty-array.js";
import UnexpectedNodeError from "../../utils/unexpected-node-error.js";
import {
  softline,
  group,
  indent,
  join,
  line,
  ifBreak,
  hardline,
} from "../../document/builders.js";
import { printDanglingComments } from "../../main/comments/print.js";

import {
  hasComment,
  CommentCheckFlags,
  shouldPrintComma,
  needsHardlineAfterDanglingComment,
  isStringLiteral,
  rawText,
  createTypeCheckFunction,
} from "../utils/index.js";
import { locStart, hasSameLoc, locEnd } from "../loc.js";
import { printDecoratorsBeforeExport } from "./decorators.js";
import { printDeclareToken } from "./misc.js";

/**
 * @typedef {import("../../document/builders.js").Doc} Doc
 */

function printImportDeclaration(path, options, print) {
  const { node } = path;
  /** @type{Doc[]} */
  return [
    "import",
    node.module ? " module" : "",
    node.phase ? ` ${node.phase}` : "",
    printImportKind(node),
    printModuleSpecifiers(path, options, print),
    printModuleSource(path, options, print),
    printImportAttributes(path, options, print),
    options.semi ? ";" : "",
  ];
}

const isDefaultExport = (node) =>
  node.type === "ExportDefaultDeclaration" ||
  (node.type === "DeclareExportDeclaration" && node.default);

/*
- `ExportDefaultDeclaration`
- `ExportNamedDeclaration`
- `DeclareExportDeclaration`(flow)
- `ExportAllDeclaration`
- `DeclareExportAllDeclaration`(flow)
*/
function printExportDeclaration(path, options, print) {
  const { node } = path;

  /** @type{Doc[]} */
  const parts = [
    printDecoratorsBeforeExport(path, options, print),
    printDeclareToken(path),
    "export",
    isDefaultExport(node) ? " default" : "",
  ];

  const { declaration, exported } = node;

  if (hasComment(node, CommentCheckFlags.Dangling)) {
    parts.push(" ", printDanglingComments(path, options));

    if (needsHardlineAfterDanglingComment(node)) {
      parts.push(hardline);
    }
  }

  if (declaration) {
    parts.push(" ", print("declaration"));
  } else {
    parts.push(printExportKind(node));

    if (
      node.type === "ExportAllDeclaration" ||
      node.type === "DeclareExportAllDeclaration"
    ) {
      parts.push(" *");
      if (exported) {
        parts.push(" as ", print("exported"));
      }
    } else {
      parts.push(printModuleSpecifiers(path, options, print));
    }

    parts.push(
      printModuleSource(path, options, print),
      printImportAttributes(path, options, print),
    );
  }

  parts.push(printSemicolonAfterExportDeclaration(node, options));

  return parts;
}

const shouldOmitSemicolon = createTypeCheckFunction([
  "ClassDeclaration",
  "FunctionDeclaration",
  "TSInterfaceDeclaration",
  "DeclareClass",
  "DeclareFunction",
  "TSDeclareFunction",
  "EnumDeclaration",
]);
function printSemicolonAfterExportDeclaration(node, options) {
  if (
    options.semi &&
    (!node.declaration ||
      (isDefaultExport(node) && !shouldOmitSemicolon(node.declaration)))
  ) {
    return ";";
  }

  return "";
}

function printImportOrExportKind(kind, spaceBeforeKind = true) {
  return kind && kind !== "value"
    ? `${spaceBeforeKind ? " " : ""}${kind}${spaceBeforeKind ? "" : " "}`
    : "";
}

function printImportKind(node, spaceBeforeKind) {
  return printImportOrExportKind(node.importKind, spaceBeforeKind);
}

function printExportKind(node) {
  return printImportOrExportKind(node.exportKind);
}

function printModuleSource(path, options, print) {
  const { node } = path;

  if (!node.source) {
    return "";
  }

  /** @type{Doc[]} */
  const parts = [];
  if (shouldPrintSpecifiers(node, options)) {
    parts.push(" from");
  }
  parts.push(" ", print("source"));

  return parts;
}

function printModuleSpecifiers(path, options, print) {
  const { node } = path;

  if (!shouldPrintSpecifiers(node, options)) {
    return "";
  }

  /** @type{Doc[]} */
  const parts = [" "];

  if (isNonEmptyArray(node.specifiers)) {
    const standaloneSpecifiers = [];
    const groupedSpecifiers = [];

    path.each(() => {
      const specifierType = path.node.type;
      if (
        specifierType === "ExportNamespaceSpecifier" ||
        specifierType === "ExportDefaultSpecifier" ||
        specifierType === "ImportNamespaceSpecifier" ||
        specifierType === "ImportDefaultSpecifier"
      ) {
        standaloneSpecifiers.push(print());
      } else if (
        specifierType === "ExportSpecifier" ||
        specifierType === "ImportSpecifier"
      ) {
        groupedSpecifiers.push(print());
      } else {
        /* c8 ignore next 3 */
        throw new UnexpectedNodeError(node, "specifier");
      }
    }, "specifiers");

    parts.push(join(", ", standaloneSpecifiers));

    if (groupedSpecifiers.length > 0) {
      if (standaloneSpecifiers.length > 0) {
        parts.push(", ");
      }

      const canBreak =
        groupedSpecifiers.length > 1 ||
        standaloneSpecifiers.length > 0 ||
        node.specifiers.some((node) => hasComment(node));

      if (canBreak) {
        parts.push(
          group([
            "{",
            indent([
              options.bracketSpacing ? line : softline,
              join([",", line], groupedSpecifiers),
            ]),
            ifBreak(shouldPrintComma(options) ? "," : ""),
            options.bracketSpacing ? line : softline,
            "}",
          ]),
        );
      } else {
        parts.push([
          "{",
          options.bracketSpacing ? " " : "",
          ...groupedSpecifiers,
          options.bracketSpacing ? " " : "",
          "}",
        ]);
      }
    }
  } else {
    parts.push("{}");
  }
  return parts;
}

function shouldPrintSpecifiers(node, options) {
  if (
    node.type !== "ImportDeclaration" ||
    isNonEmptyArray(node.specifiers) ||
    node.importKind === "type"
  ) {
    return true;
  }

  const text = getTextWithoutComments(
    options,
    locStart(node),
    locStart(node.source),
  );

  return text.trimEnd().endsWith("from");
}

function shouldPrintAttributes(node, options) {
  if (!node.source) {
    return false;
  }

  if (isNonEmptyArray(node.attributes) || isNonEmptyArray(node.assertions)) {
    return true;
  }

  const text = getTextWithoutComments(
    options,
    locEnd(node.source),
    locEnd(node),
  ).trimStart();

  return text.startsWith("with") || text.startsWith("assert");
}

function getTextWithoutComments(options, start, end) {
  let text = options.originalText.slice(start, end);

  for (const comment of options[Symbol.for("comments")]) {
    const commentStart = locStart(comment);
    // Comments are sorted, we can escape if the comment is after the range
    if (commentStart > end) {
      break;
    }

    const commentEnd = locEnd(comment);
    if (commentEnd < start) {
      continue;
    }

    const commentLength = commentEnd - commentStart;
    text =
      text.slice(0, commentStart - start) +
      " ".repeat(commentLength) +
      text.slice(commentEnd - start);
  }

  if (process.env.NODE_ENV !== "production") {
    assert(text.length === end - start);
  }

  return text;
}

function getImportAttributesOrAssertionsKeyword(node, options) {
  if (
    // Babel parser add this property to indicate the keyword is `assert`
    node.extra?.deprecatedAssertSyntax ||
    (isNonEmptyArray(node.assertions) && !isNonEmptyArray(node.attributes))
  ) {
    return "assert";
  }

  if (!isNonEmptyArray(node.assertions) && isNonEmptyArray(node.attributes)) {
    return "with";
  }

  const firstAttribute = node.attributes?.[0] ?? node.assertions?.[0];
  const textBetweenSourceAndAttributes = getTextWithoutComments(
    options,
    locEnd(node.source),
    firstAttribute ? locStart(firstAttribute) : locEnd(node),
  );

  if (textBetweenSourceAndAttributes.trimStart().startsWith("assert")) {
    return "assert";
  }

  return "with";
}

/**
 * Print Import Attributes syntax.
 * If old ImportAssertions syntax is used, print them here.
 */
function printImportAttributes(path, options, print) {
  const { node } = path;

  if (!shouldPrintAttributes(node, options)) {
    return "";
  }

  const keyword = getImportAttributesOrAssertionsKeyword(node, options);
  /** @type{Doc[]} */
  const parts = [` ${keyword} {`];

  const property = isNonEmptyArray(node.attributes)
    ? "attributes"
    : isNonEmptyArray(node.assertions)
      ? "assertions"
      : undefined;
  if (property) {
    if (options.bracketSpacing) {
      parts.push(" ");
    }

    parts.push(join(", ", path.map(print, property)));

    if (options.bracketSpacing) {
      parts.push(" ");
    }
  }
  parts.push("}");

  return parts;
}

function printModuleSpecifier(path, options, print) {
  const { node } = path;
  const { type } = node;

  const isImportSpecifier = type.startsWith("Import");
  const leftSideProperty = isImportSpecifier ? "imported" : "local";
  const rightSideProperty = isImportSpecifier ? "local" : "exported";
  const leftSideNode = node[leftSideProperty];
  const rightSideNode = node[rightSideProperty];
  let left = "";
  let right = "";
  if (
    type === "ExportNamespaceSpecifier" ||
    type === "ImportNamespaceSpecifier"
  ) {
    left = "*";
  } else if (leftSideNode) {
    left = print(leftSideProperty);
  }

  if (rightSideNode && !isShorthandSpecifier(node)) {
    right = print(rightSideProperty);
  }

  return [
    printImportOrExportKind(
      type === "ImportSpecifier" ? node.importKind : node.exportKind,
      /* spaceBeforeKind */ false,
    ),
    left,
    left && right ? " as " : "",
    right,
  ];
}

function isShorthandSpecifier(specifier) {
  if (
    specifier.type !== "ImportSpecifier" &&
    specifier.type !== "ExportSpecifier"
  ) {
    return false;
  }

  const {
    local,
    [specifier.type === "ImportSpecifier" ? "imported" : "exported"]:
      importedOrExported,
  } = specifier;

  if (
    local.type !== importedOrExported.type ||
    !hasSameLoc(local, importedOrExported)
  ) {
    return false;
  }

  if (isStringLiteral(local)) {
    return (
      local.value === importedOrExported.value &&
      rawText(local) === rawText(importedOrExported)
    );
  }

  switch (local.type) {
    case "Identifier":
      return local.name === importedOrExported.name;
    default:
      /* c8 ignore next */
      return false;
  }
}

export {
  printImportDeclaration,
  printExportDeclaration,
  printModuleSpecifier,
  printImportKind,
};
