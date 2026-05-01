import Alpine from 'alpinejs';
import './styles.css';

declare global {
  interface Window {
    Alpine: typeof Alpine;
    heroDemo: () => HeroDemoState;
  }
}

interface HeroDemoState {
  lines: string[];
  cursorOn: boolean;
  start: () => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Simulated `runner run` output for the hero terminal.
 *
 * Animates the run line-by-line in compressed real-ish time. Steps that
 * are in progress show a pulsing `▸` and update to `✓` when their
 * simulated duration elapses. Two jobs interleave to feel like real
 * parallel scheduling.
 */
window.heroDemo = (): HeroDemoState => ({
  lines: [],
  cursorOn: true,

  async start() {
    // Loop forever — this is the hero, the page never leaves it.
    // Each cycle runs the simulation, holds the final state for a beat,
    // then resets and starts again.
    while (true) {
      await this.runOnce();
      await sleep(4200);
    }
  },

  async runOnce(this: HeroDemoState & { runOnce: () => Promise<void> }) {
    const push = (html: string): number => {
      this.lines.push(html);
      return this.lines.length - 1;
    };
    const replace = (idx: number, html: string) => {
      this.lines[idx] = html;
    };

    // Banner
    this.lines = [];
    push('<span class="comment"># gitgate · CI</span>');
    await sleep(80);
    push('<span class="comment">workflow: .github/workflows/ci.yml</span>');
    await sleep(70);
    push('<span class="comment">jobs:     2  (parallel ≤ 4)</span>');
    await sleep(220);

    // Job 1: typecheck
    push('');
    push('<span class="ok">▶</span> <span class="text-white">job: typecheck</span>  <span class="comment">(host · ubicloud-standard-4)</span>');
    await sleep(120);
    push('  <span class="ok">⊘</span> Checkout                                  <span class="comment">host has the repo</span>');
    await sleep(60);
    push('  <span class="ok">⊘</span> Setup pnpm                                <span class="comment">host has pnpm</span>');
    await sleep(60);
    push('  <span class="ok">⊘</span> Setup Node 22                             <span class="comment">host has node v22.19.0</span>');
    await sleep(100);
    const tcInstall = push('  <span class="running">▸</span> Install                                   <span class="comment">running…</span>');
    await sleep(720);
    replace(tcInstall, '  <span class="ok">✓</span> Install                                   <span class="comment">1.40s</span>');
    const tcTypecheck = push('  <span class="running">▸</span> Typecheck                                 <span class="comment">running…</span>');

    // Job 2: test (interleaves)
    await sleep(140);
    push('');
    push('<span class="ok">▶</span> <span class="text-white">job: test</span>  <span class="comment">(host · ubicloud-standard-4)</span>');
    await sleep(100);
    push('  <span class="ok">⊘</span> Checkout                                  <span class="comment">host has the repo</span>');
    await sleep(50);
    push('  <span class="ok">⊘</span> Setup pnpm                                <span class="comment">host has pnpm</span>');
    await sleep(50);
    push('  <span class="ok">⊘</span> Setup Node 22                             <span class="comment">host has node v22.19.0</span>');
    await sleep(100);
    const tInstall = push('  <span class="running">▸</span> Install                                   <span class="comment">running…</span>');
    await sleep(640);
    replace(tInstall, '  <span class="ok">✓</span> Install                                   <span class="comment">1.45s</span>');
    const tTsCi = push('  <span class="running">▸</span> Test ts-ci                                <span class="comment">running…</span>');
    await sleep(580);
    replace(tTsCi, '  <span class="ok">✓</span> Test ts-ci                                <span class="comment">1.13s</span>');
    const tGit = push('  <span class="running">▸</span> Test git-engine                           <span class="comment">running…</span>');

    // Typecheck finishes mid-way through git-engine tests
    await sleep(820);
    replace(tcTypecheck, '  <span class="ok">✓</span> Typecheck                                 <span class="comment">3.18s</span>');

    // git-engine wraps up
    await sleep(820);
    replace(tGit, '  <span class="ok">✓</span> Test git-engine                           <span class="comment">3.71s</span>');

    // Summary
    await sleep(220);
    push('<span class="comment">────────────────────────────────────────────────────────────────────────</span>');
    await sleep(80);
    push('<span class="text-white">CI</span>  <span class="ok">PASS</span>  <span class="num">9.09s</span>  <span class="comment">(202 tests · 2 jobs in parallel)</span>');
  },
} as HeroDemoState);

window.Alpine = Alpine;
Alpine.start();
