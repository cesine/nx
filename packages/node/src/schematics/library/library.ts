import { normalize, Path } from '@angular-devkit/core';
import {
  apply,
  chain,
  externalSchematic,
  filter,
  MergeStrategy,
  mergeWith,
  move,
  noop,
  Rule,
  SchematicContext,
  SchematicsException,
  template,
  Tree,
  url,
} from '@angular-devkit/schematics';
import {
  formatFiles,
  getNpmScope,
  updateWorkspaceInTree,
} from '@nrwl/workspace';
import { Schema } from './schema';
import { libsDir } from '@nrwl/workspace/src/utils/ast-utils';
import {
  maybeJs,
  toJS,
  updateTsConfigsToJs,
} from '@nrwl/workspace/src/utils/rules/to-js';
import { names, offsetFromRoot } from '@nrwl/devkit';
import { wrapAngularDevkitSchematic } from '@nrwl/devkit/ngcli-adapter';

export interface NormalizedSchema extends Schema {
  name: string;
  prefix: string;
  fileName: string;
  projectRoot: Path;
  projectDirectory: string;
  parsedTags: string[];
}

export default function (schema: NormalizedSchema): Rule {
  return (host: Tree, context: SchematicContext) => {
    const options = normalizeOptions(host, schema);

    if (options.publishable === true && !schema.importPath) {
      throw new SchematicsException(
        `For publishable libs you have to provide a proper "--importPath" which needs to be a valid npm package name (e.g. my-awesome-lib or @myorg/my-lib)`
      );
    }

    return chain([
      externalSchematic('@nrwl/workspace', 'lib', {
        ...schema,
        importPath: options.importPath,
      }),
      createFiles(options),
      options.js ? updateTsConfigsToJs(options) : noop(),
      addProject(options),
      formatFiles(options),
    ]);
  };
}

function normalizeOptions(host: Tree, options: Schema): NormalizedSchema {
  const defaultPrefix = getNpmScope(host);
  const name = names(options.name).fileName;
  const projectDirectory = options.directory
    ? `${names(options.directory).fileName}/${name}`
    : name;

  const projectName = projectDirectory.replace(new RegExp('/', 'g'), '-');
  const fileName = projectName;
  const projectRoot = normalize(`${libsDir(host)}/${projectDirectory}`);

  const parsedTags = options.tags
    ? options.tags.split(',').map((s) => s.trim())
    : [];

  const importPath =
    options.importPath || `@${defaultPrefix}/${projectDirectory}`;

  return {
    ...options,
    prefix: defaultPrefix, // we could also allow customizing this
    fileName,
    name: projectName,
    projectRoot,
    projectDirectory,
    parsedTags,
    importPath,
  };
}

function createFiles(options: NormalizedSchema): Rule {
  return mergeWith(
    apply(url(`./files/lib`), [
      template({
        ...options,
        ...names(options.name),
        tmpl: '',
        offsetFromRoot: offsetFromRoot(options.projectRoot),
      }),
      move(options.projectRoot),
      options.unitTestRunner === 'none'
        ? filter((file) => !file.endsWith('spec.ts'))
        : noop(),
      options.publishable || options.buildable
        ? noop()
        : filter((file) => !file.endsWith('package.json')),
      options.js ? toJS() : noop(),
    ]),
    MergeStrategy.Overwrite
  );
}

function addProject(options: NormalizedSchema): Rule {
  if (!options.publishable && !options.buildable) {
    return noop();
  }

  return updateWorkspaceInTree((json, context, host) => {
    const { architect } = json.projects[options.name];
    if (architect) {
      architect.build = {
        builder: '@nrwl/node:package',
        outputs: ['{options.outputPath}'],
        options: {
          outputPath: `dist/${libsDir(host)}/${options.projectDirectory}`,
          tsConfig: `${options.projectRoot}/tsconfig.lib.json`,
          packageJson: `${options.projectRoot}/package.json`,
          main: maybeJs(options, `${options.projectRoot}/src/index.ts`),
          assets: [`${options.projectRoot}/*.md`],
        },
      };

      if (options.rootDir) {
        architect.build.options.srcRootForCompilationRoot = options.rootDir;
      }
    }
    return json;
  });
}

export const libraryGenerator = wrapAngularDevkitSchematic(
  '@nrwl/node',
  'library'
);
