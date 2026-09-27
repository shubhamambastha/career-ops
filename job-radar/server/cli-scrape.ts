// CLI: `npm run scrape -- [--full] [--source jsgurujobs]` — same scraper as the UI's "Scrape" button,
// handy for cron / launchd.
import { runScrape, status } from "./scrape";
import { store } from "./store";

const args = process.argv.slice(2);
const mode = args.includes("--full") ? "full" : "quick";
const only = args.includes("--source") ? args[args.indexOf("--source") + 1] : undefined;

const sources = store.getSettings().sources.filter((s) => s.enabled && (!only || s.id === only));
for (const s of sources) {
  await runScrape(s, mode);
}
console.log(`finished: +${status.added} new, ${status.updated} refreshed, ${status.gone} gone, ${status.errors} errors`);
