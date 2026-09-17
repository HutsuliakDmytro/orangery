import { workspaceConfig } from '../../eslint.config.base.js'

export default workspaceConfig({
  rootDir: import.meta.dirname,
  react: true,
  ignores: ['src-tauri/target', 'src-tauri/gen'],
})
