# Blog (Hexo + GitHub Pages)

This repo contains a Hexo blog site deployed to GitHub Pages.

## Prerequisites

- **Conda environment**: `hexo` (Node.js + npm installed inside it)
- **Git** installed and authenticated with GitHub

## Setup (first time on a new machine)

```powershell
cd D:\Downloads\code\blog

conda activate hexo

# install JS dependencies
npm install
```

## Create a new post (write a new article)

```powershell
cd D:\Downloads\code\blog
conda activate hexo

# create a new post markdown under source/_posts/
hexo new post "<new-post-title>"
```

It will generate a file like:

- `source/_posts/<new-post-title>.md`

Open the markdown file and edit the content.

### Common front-matter fields

At the top of the post file:

```yaml
---
title: My New Post Title
date: 2026-04-25 00:00:00
tags:
  - tag1
  - tag2
categories:
  - category1
---
```

## Local preview

```powershell
cd D:\Downloads\code\blog
conda activate hexo

hexo clean
hexo server
```

Then open:

- `http://localhost:4000/`

Stop the server with `Ctrl + C`.

## Publish (deploy to GitHub Pages)

This repo uses **GitHub Actions** to build and deploy automatically on push.

```powershell
cd D:\Downloads\code\blog

git status
git add -A
git commit -m "Add post: My New Post Title"
git push
```

After pushing, go to the GitHub Actions page and wait for the workflow to finish.

## Notes

- **About page**: `source/about/index.md`
- **Theme config**: `themes/maple/_config.yml`
- **Site config**: `_config.yml`

