/**
 * Rehearse uses its own CI SDK to compile its workflows.
 * Sources live in `.rehearse/pipelines/`, output in `.github/workflows/`.
 */
const config = {
  pipelinesDir: '.rehearse/pipelines',
  outputDir: '.github/workflows',
};

export default config;
