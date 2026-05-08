/* eslint-disable no-var */
/* global hexo */

// Generate language-prefixed routes like:
// /en/ , /en/archives/ , /en/tags/ , /en/tags/<tag>/ , /en/categories/ , /en/categories/<cat>/
// and the same for /zh-CN/.
//
// Language detection:
// - If post.lang exists, use it.
// - Else infer from filename suffix: *.zh-CN.md => zh-CN, otherwise en.

var pagination = require("hexo-pagination");

function normalizeLang(lang) {
  if (!lang) return "en";
  if (Array.isArray(lang)) lang = lang[0];
  return (lang + "").split(",")[0].trim();
}

function detectPostLang(post) {
  if (post.lang) return normalizeLang(post.lang);
  var src = post.source || post.full_source || "";
  if (typeof src === "string" && src.endsWith(".zh-CN.md")) return "zh-CN";
  return "en";
}

function getLangsFromConfig() {
  var langs = hexo.config.language;
  if (!langs) return ["en"];
  if (!Array.isArray(langs)) langs = [langs];
  langs = langs.map(normalizeLang).filter(Boolean);
  // Keep only the languages we actually want routes for.
  // (Add more here if you later add zh-TW, etc.)
  var allow = { en: true, "zh-CN": true };
  return langs.filter(function (l) {
    return allow[l];
  });
}

function postsForLang(allPosts, lang) {
  return allPosts.filter(function (p) {
    return detectPostLang(p) === lang;
  });
}

function buildTaxonomyMap(posts, field) {
  // field: "tags" or "categories"
  // returns Map<string, Post[]>
  var map = new Map();
  posts.forEach(function (post) {
    var items = post[field];
    if (!items || !items.length) return;

    items.forEach(function (it) {
      var name = it && it.name ? it.name : null;
      if (!name) return;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(post);
    });
  });
  return map;
}

function sortKeys(map) {
  return Array.from(map.keys()).sort(function (a, b) {
    return a.localeCompare(b);
  });
}

function encodeSegment(seg) {
  return encodeURIComponent(seg).replace(/%2F/g, "/");
}

hexo.extend.generator.register("i18n-routes", function (locals) {
  var langs = getLangsFromConfig();
  var allPosts = locals.posts.sort("-date");
  var perPage = (hexo.config.index_generator && hexo.config.index_generator.per_page) || 10;

  var routes = [];

  langs.forEach(function (lang) {
    var langPosts = postsForLang(allPosts, lang);

    // /<lang>/ (index)
    routes = routes.concat(
      pagination(lang + "/", langPosts, {
        perPage: perPage,
        layout: ["archive", "index"],
        data: {
          __i18n: { lang: lang, type: "index" },
        },
      })
    );

    // /<lang>/archives/
    routes = routes.concat(
      pagination(lang + "/archives/", langPosts, {
        perPage: perPage,
        layout: ["archive"],
        data: {
          __i18n: { lang: lang, type: "archives" },
        },
      })
    );

    // /<lang>/tags/ + /<lang>/tags/<tag>/
    var tagMap = buildTaxonomyMap(langPosts, "tags");
    var tagKeys = sortKeys(tagMap);
    routes.push({
      path: lang + "/tags/index.html",
      layout: ["i18n-tags"],
      data: {
        lang: lang,
        tags: tagKeys.map(function (name) {
          return { name: name, count: tagMap.get(name).length };
        }),
      },
    });
    tagKeys.forEach(function (tagName) {
      var posts = tagMap.get(tagName).slice().sort(function (a, b) {
        return b.date.valueOf() - a.date.valueOf();
      });
      routes = routes.concat(
        pagination(lang + "/tags/" + encodeSegment(tagName) + "/", posts, {
          perPage: perPage,
          layout: ["archive"],
          data: {
            __i18n: { lang: lang, type: "tag", name: tagName },
            pageTitle: "Tags - " + tagName,
          },
        })
      );
    });

    // /<lang>/categories/ + /<lang>/categories/<cat>/
    var catMap = buildTaxonomyMap(langPosts, "categories");
    var catKeys = sortKeys(catMap);
    routes.push({
      path: lang + "/categories/index.html",
      layout: ["i18n-categories"],
      data: {
        lang: lang,
        categories: catKeys.map(function (name) {
          return { name: name, count: catMap.get(name).length };
        }),
      },
    });
    catKeys.forEach(function (catName) {
      var cPosts = catMap.get(catName).slice().sort(function (a, b) {
        return b.date.valueOf() - a.date.valueOf();
      });
      routes = routes.concat(
        pagination(lang + "/categories/" + encodeSegment(catName) + "/", cPosts, {
          perPage: perPage,
          layout: ["archive"],
          data: {
            __i18n: { lang: lang, type: "category", name: catName },
            pageTitle: "Categories - " + catName,
          },
        })
      );
    });
  });

  return routes;
});

