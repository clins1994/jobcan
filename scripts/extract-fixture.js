/* eslint-disable @typescript-eslint/no-require-imports */
const { parse } = require("node-html-parser");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Extract HTML from markdown file (between ```html tags)
 */
function extractHtmlFromMarkdown(markdownPath) {
  const content = fs.readFileSync(markdownPath, "utf-8");
  const htmlMatch = content.match(/```html\n([\s\S]*?)\n```/);
  if (!htmlMatch) {
    throw new Error(`No HTML block found in ${markdownPath}`);
  }
  return htmlMatch[1];
}

/**
 * Extract minimal HTML keeping the hierarchy that leads to attendance table
 */
function extractMinimalHtml(html) {
  const root = parse(html);
  
  // Find the main container that holds the attendance content
  // Structure: main > jbc-container > card > card-body > search-result > table-responsive > table
  const main = root.querySelector("main");
  if (!main) {
    throw new Error("No main element found in HTML");
  }

  // Find the card that contains the attendance table
  const card = main.querySelector(".card.jbc-card");
  if (!card) {
    throw new Error("No attendance card found in HTML");
  }

  // Find the search-result div that contains the attendance table
  const searchResult = card.querySelector("#search-result");
  if (!searchResult) {
    throw new Error("No search-result div found in card");
  }

  // Find the attendance table within search-result - it should have thead and tbody
  const tables = searchResult.querySelectorAll("table.jbc-table");
  let table = null;
  for (const t of tables) {
    if (t.querySelector("thead") && t.querySelector("tbody")) {
      table = t;
      break;
    }
  }
  if (!table) {
    throw new Error("No attendance table with thead/tbody found in search-result");
  }

  // Remove dropdown menus and font tags from table cells but keep everything else
  const rows = table.querySelectorAll("tbody tr");
  rows.forEach((row) => {
    const cells = row.querySelectorAll("td");
    cells.forEach((cell) => {
      // Remove dropdown menus from date cell (first cell)
      const dropdown = cell.querySelector(".dropdown-menu");
      if (dropdown) {
        dropdown.remove();
      }
      
      // Remove all font tags but preserve their text content
      const fontTags = cell.querySelectorAll("font");
      fontTags.forEach((font) => {
        const text = font.text;
        const textNode = parse(text).querySelector("body");
        if (textNode) {
          font.replaceWith(textNode.innerHTML);
        } else {
          font.replaceWith(text);
        }
      });
    });
  });
  
  // Also remove font tags from thead
  const thead = table.querySelector("thead");
  if (thead) {
    const theadFontTags = thead.querySelectorAll("font");
    theadFontTags.forEach((font) => {
      const text = font.text;
      font.replaceWith(text);
    });
  }

  // Remove collapse section (summary info) - we can add it back if needed for summary parsing tests
  const collapseInfo = searchResult.querySelector("#collapseInfo");
  if (collapseInfo) {
    collapseInfo.remove();
  }

  // Remove form and other non-table elements from card-body, keep only search-result
  const cardBody = card.querySelector(".card-body");
  if (cardBody) {
    // Remove everything except search-result
    const children = Array.from(cardBody.childNodes);
    children.forEach((child) => {
      if (child.id !== "search-result" && child.id !== "message-box") {
        child.remove();
      }
    });
  }

  // Remove header, navigation, sidebar, footer, scripts, styles
  const head = root.querySelector("head");
  if (head) {
    // Keep only charset meta
    const children = Array.from(head.childNodes);
    children.forEach((child) => {
      if (child.tagName !== "META" || child.getAttribute("charset") !== "utf-8") {
        child.remove();
      }
    });
  }

  // Remove header, sidebar, footer from body
  const body = root.querySelector("body");
  if (body) {
    const header = body.querySelector("header");
    if (header) header.remove();
    const sidebar = body.querySelector("#sidemenu, #sidemenu-closed");
    if (sidebar) sidebar.remove();
    const footer = body.querySelector("footer");
    if (footer) footer.remove();
    
    // Keep only main content
    const bodyChildren = Array.from(body.childNodes);
    bodyChildren.forEach((child) => {
      if (child.tagName !== "MAIN" && child.tagName !== "SCRIPT") {
        child.remove();
      }
    });
  }

  // Create minimal HTML document preserving the hierarchy
  const minimalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Attendance Fixture</title>
</head>
<body>
  ${main.outerHTML}
</body>
</html>`;

  return minimalHtml;
}

/**
 * Main function
 */
function main() {
  const sandboxDir = path.join(__dirname, "..", "sandbox");
  const testFixturesDir = path.join(__dirname, "..", "test", "fixtures");

  // Ensure test/fixtures directory exists
  if (!fs.existsSync(testFixturesDir)) {
    fs.mkdirSync(testFixturesDir, { recursive: true });
  }

  const files = [
    { input: "attendance-previous.md", output: "attendance-previous.html" },
    { input: "attendance-current.md", output: "attendance-current.html" },
  ];

  for (const file of files) {
    const inputPath = path.join(sandboxDir, file.input);
    const outputPath = path.join(testFixturesDir, file.output);

    console.log(`Processing ${file.input}...`);
    const html = extractHtmlFromMarkdown(inputPath);
    const minimalHtml = extractMinimalHtml(html);
    fs.writeFileSync(outputPath, minimalHtml, "utf-8");
    
    // Format with prettier
    try {
      execSync(`npx prettier --write "${outputPath}"`, { stdio: "inherit" });
      console.log(`Formatted ${file.output} with prettier`);
    } catch (error) {
      console.warn(`Warning: Failed to format ${file.output} with prettier:`, error.message);
    }
    
    console.log(`Saved minimal fixture to ${file.output}`);
  }

  console.log("Done!");
}

main();

