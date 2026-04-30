import { step } from '../builder/step.js';
import type { Step } from '../types.js';

export const rust = {
  setup(toolchain: string = 'stable'): Step {
    return {
      name: `Setup Rust (${toolchain})`,
      uses: 'dtolnay/rust-toolchain@stable',
      with: { toolchain, components: 'clippy, rustfmt' },
    };
  },
  cache(): Step {
    return step.cache({
      name: 'Cache cargo',
      path: ['~/.cargo/registry', '~/.cargo/git', 'target'],
      key: "${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}",
      restoreKeys: ['${{ runner.os }}-cargo-'],
    });
  },
  check(): Step {
    return step.run('cargo check --all-targets', { name: 'cargo check' });
  },
  clippy(): Step {
    return step.run('cargo clippy --all-targets -- -D warnings', { name: 'cargo clippy' });
  },
  test(): Step {
    return step.run('cargo test', { name: 'cargo test' });
  },
  build(release: boolean = false): Step {
    return step.run(release ? 'cargo build --release' : 'cargo build', {
      name: release ? 'cargo build --release' : 'cargo build',
    });
  },
};
