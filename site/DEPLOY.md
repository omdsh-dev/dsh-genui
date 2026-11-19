# Deploying this site into `omdsh-dev/dsh-genui`

Target: replace the current product site at <https://omdsh-dev.github.io/dsh-genui/> with this one,
keeping the existing GitHub Pages pipeline (repo → Actions → Pages) and the generated anthology page.

The site is built in this workspace. Two ways to ship it:

---

## A. Integrate into the plugin repo (recommended)

1. **Copy the site into the repo as `site/`** (replacing the old Pages payload, keeping generated
   files out of git):

   ```bash
   cd /Users/changfenhuang/projects/dsh-genui
   # keep the old site dir as a backup outside the repo
   mv site /tmp/dsh-genui-old-site
   mkdir site
   rsync -a --exclude 'assets/genui' --exclude '.dev' --exclude 'proto/shots' \
     /Users/changfenhuang/projects/DSH_innovation/genui-site/ site/
   ```

2. **Make CI build the site.** In `.github/workflows/deploy-product-site.yml`, insert one step after
   `pnpm build` and before the anthology step:

   ```yaml
         - name: Build product site (validate specs + vendor renderer)
           run: npx tsx site/scripts/build-site.mjs
   ```

   The workflow already runs `pnpm install`, `pnpm build`, then uploads `./site`; the anthology
   generator writes `site/anthology.html`. No other change needed.

3. **Gitignore generated output.** Append to `.gitignore`:

   ```
   site/assets/genui/*.js
   site/assets/genui/theme.css
   site/assets/genui/artifacts.json
   site/proto/demo-artifacts.json
   site/proto/shots/
   ```

4. **Build once locally to confirm** (requires the plugin `lib/` to be fresh):

   ```bash
   cd /Users/changfenhuang/projects/dsh-genui
   pnpm build
   npx tsx site/scripts/build-site.mjs
   npx tsx scripts/build-anthology-page.mts
   node site/scripts/serve.cjs site 8903
   # open http://127.0.0.1:8903/ and check hero/surfaces/playground/atlas in both languages
   ```

5. **Commit and push** (push to `main` triggers the Pages deploy):

   ```bash
   git add site .github/workflows/deploy-product-site.yml .gitignore
   git commit -m "docs: rebuild the product site around live GenUI demos"
   git push origin main
   ```

6. **Verify the live site** after the workflow finishes:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://omdsh-dev.github.io/dsh-genui/
   ```

## B. Keep it in this workspace only

```bash
cd /Users/changfenhuang/projects/DSH_innovation/genui-site
node scripts/serve.cjs . 8902
# http://127.0.0.1:8902/
```

Regenerate after spec/copy/design edits:

```bash
/Users/changfenhuang/projects/dsh-genui/node_modules/.bin/tsx scripts/build-site.mjs
```

---

## Notes

- `site/content/specs/**` (84 specs), `site/assets/{css,js,i18n,fonts,img}/`, `index.html` are hand
  maintained and belong in git. `site/assets/genui/**` and `site/anthology.html` are generated.
- `site/proto/` is the bridge proof harness, not part of the page; excluding `proto/shots` keeps
  ~2.8 MB of screenshots out of the deploy.
- CI must run `pnpm build` **before** `build-site.mjs`, otherwise the vendored renderer is stale and
  a few node types (`editor`, `entity-card`, `popover`) render empty.
- The old site is a 368 KB React bundle with Manus runtime/analytics scripts; it should be deleted
  from `site/` (step 1 does this by moving the directory out).
