import fs from "node:fs";
import path from "node:path";

const publicDir = path.join(process.cwd(), "public");
const indexPath = path.join(publicDir, "index.html");

if (!fs.existsSync(publicDir)) {
  throw new Error(`public directory not found at: ${publicDir}`);
}

if (fs.existsSync(indexPath)) {
  console.log("public/index.html already exists; skipping redirect generation.");
  process.exit(0);
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Redirecting…</title>
    <meta http-equiv="refresh" content="0; url=/en/" />
    <script>
      (function () {
        try {
          var lang = (navigator.language || navigator.userLanguage || "en").toLowerCase();
          var target = lang.startsWith("zh") ? "/zh-CN/" : "/en/";
          if (location.pathname === "/" || location.pathname === "") {
            location.replace(target);
          }
        } catch (e) {}
      })();
    </script>
  </head>
  <body>
    <p>Redirecting… If you are not redirected, <a href="/en/">click here</a>.</p>
  </body>
</html>
`;

fs.writeFileSync(indexPath, html, "utf8");
console.log("Generated public/index.html redirect to /en/ (auto-detect zh).");

