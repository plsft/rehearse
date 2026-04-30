/**
 * GitGate uses its own CI SDK to compile its workflows.
 * Sources live in `.gitgate/pipelines/`, output in `.github/workflows/`.
 */
const config = {
  pipelinesDir: '.gitgate/pipelines',
  outputDir: '.github/workflows',
};

export default config;
