# Supply Price Desk: setup

Everything here is on free plans. It takes about 20 minutes, once.

## 1. Firebase (where the shared data lives)

1. Go to https://console.firebase.google.com and click **Create a project**. Any name works, e.g. `supply-price-desk`. You can turn Google Analytics off.
2. **Databases & Storage > Firestore > Create database** (also under Project shortcuts > Firestore). Pick a location near you (e.g. `europe-west1`) and start in **production mode**.
3. In Firestore, open the **Rules** tab, replace everything with the contents of `firestore.rules`, put your team's Gmail addresses in the list, and click **Publish**. To add or remove someone later, edit this list again.
4. **Security > Authentication > Get started > Sign-in method > Google > Enable**, choose a support email, and save.
5. **Authentication > Settings > Authorized domains > Add domain** and add `YOUR-GITHUB-NAME.github.io`.
6. **Project settings** (gear icon) **> Your apps > Web (`</>`)**. Register an app with any nickname (no Hosting needed). Copy the values from the `firebaseConfig` it shows into `firebase-config.js`.

## 2. GitHub Pages (where the website lives)

1. Put these files in the repository: `index.html`, `table-reader.js`, `pdf-import.js`, `matcher.js`, `firebase-config.js`.
2. In the repository, open **Settings > Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
3. After a minute the site is at `https://YOUR-GITHUB-NAME.github.io/REPOSITORY-NAME/`.

## 3. First use

1. Open the site and sign in with Google using one of the emails in the rules.
2. Go to **Settings > Backup > Load a backup file** and choose `supply-price-desk-starting-data.json`. This loads the Curanza and Omega lists (1,894 products).
3. Share the link with your team. Each person signs in with their own Google account.

## Good to know

- Download a backup from **Settings > Backup** now and then and keep it somewhere safe.
- Excel and CSV files import instantly. PDFs with real text import in seconds. Scanned PDFs and photos are read on the device and take up to about a minute per page; check names and prices before importing.
- Free limits (Firestore Spark plan): 50,000 reads and 20,000 writes a day and 1 GB stored. A team of 3 to 4 people stays well inside this.
- Keep the starting-data file out of the repository: a free GitHub Pages repository is public.

## Checking the site (tests)

The `tests` folder checks every tab and upload type in a browser, using small made-up price lists and a stand-in for Firebase, so it never touches your real data. GitHub runs it on every pull request. To run it on your computer, install Node.js, then in this folder run `npm install`, `npx playwright install chromium` and `npm test`.
