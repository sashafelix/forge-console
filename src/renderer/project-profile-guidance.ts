import { buildProjectProfile } from '../shared/project-profile';
import type { ProjectProfileDraft } from '../shared/project-profile';

/** Generic input hints and separate worked examples; neither populates the user's draft. */
export const PROJECT_PROFILE_GUIDANCE: Record<keyof ProjectProfileDraft, { help: string; placeholder: string; example: string }> = {
  projectId: {
    help: 'A stable name for the target project, usually its repository name.',
    placeholder: 'your-project',
    example: 'example-webapp'
  },
  profileVersion: {
    help: 'Revision of these project facts. Start at 1 and increment when you publish an updated profile.',
    placeholder: 'Profile revision',
    example: '1'
  },
  issuedBy: {
    help: 'The person or team who prepared and reviewed these facts.',
    placeholder: 'Your name or team',
    example: 'Example engineering team'
  },
  root: {
    help: 'Path to the target repository as seen by the pipeline. Use . when its working directory is that repository.',
    placeholder: 'Path to your repository',
    example: '.'
  },
  stack: {
    help: 'Languages and runtimes used by the project, one per line. Check its README and package or build files.',
    placeholder: 'Languages and runtimes, one per line',
    example: 'TypeScript\nNode.js'
  },
  frameworks: {
    help: 'The main application, build and test frameworks, one per line.',
    placeholder: 'Frameworks used by your project, one per line',
    example: 'React\nVite\nVitest'
  },
  build: {
    help: 'Existing commands that produce the application build, run from the project root. Check package.json, the Makefile or CI configuration.',
    placeholder: 'Your build commands, one per line',
    example: 'npm run build'
  },
  test: {
    help: 'Existing commands that run tests and finish without watch mode, one per line.',
    placeholder: 'Your test commands, one per line',
    example: 'npm run test -- --run'
  },
  lint: {
    help: 'Existing lint, formatting-check or static-analysis commands, one per line.',
    placeholder: 'Your lint or static-analysis commands, one per line',
    example: 'npm run lint\nnpm run typecheck'
  },
  architectureStyle: {
    help: 'A short description of how the code is organised.',
    placeholder: 'How your application is organised',
    example: 'React single-page app with feature modules and a REST API client'
  },
  architectureSource: {
    help: 'Path or URL of the current architecture document or decision record. Leave blank if none exists.',
    placeholder: 'Path or URL to your architecture documentation',
    example: 'docs/architecture.md'
  },
  environment: {
    help: 'Relevant operating systems, local services and CI setup. Include prerequisites such as Docker or a test database.',
    placeholder: 'Development platforms, CI setup and required services',
    example: 'Developed on macOS and Linux. CI runs on Ubuntu. Integration tests use a disposable PostgreSQL database in Docker.'
  },
  constraints: {
    help: 'Established compatibility, data or product requirements that changes must respect, one per line.',
    placeholder: 'Requirements your changes must respect, one per line',
    example: 'Keep existing public API responses compatible.\nStore timestamps in UTC.'
  },
  modules: {
    help: 'Optional map of the main code areas. Each entry needs exactly name, path and purpose; paths are relative to the project root. Keep [] if unknown.',
    placeholder: '[{"name":"Module name","path":"relative/path","purpose":"What this module does"}]',
    example: JSON.stringify([
      { name: 'Web app', path: 'src', purpose: 'User interface and feature logic' },
      { name: 'API client', path: 'src/api', purpose: 'Typed requests to the backend' }
    ], null, 2)
  },
  decisions: {
    help: 'Optional agreed technical choices as JSON keys with text values. Keep {} if none are recorded. Execution permissions and approvals belong in the run policy.',
    placeholder: '{"technical_choice":"Your agreed decision"}',
    example: JSON.stringify({ package_manager: 'npm; commit package-lock.json', api_style: 'REST with JSON responses' }, null, 2)
  },
  sourceRef: {
    help: 'Optional document, URL or reference from which these facts were prepared. Leave blank when there is no existing source.',
    placeholder: 'Document, URL or reference for these facts',
    example: 'docs/project-context.md'
  }
};

const exampleDraft = Object.fromEntries(Object.entries(PROJECT_PROFILE_GUIDANCE).map(([key, guidance]) => [key, guidance.example])) as ProjectProfileDraft;
export const EXAMPLE_PROJECT_PROFILE = buildProjectProfile(exampleDraft, '2026-01-01T00:00:00.000Z');
