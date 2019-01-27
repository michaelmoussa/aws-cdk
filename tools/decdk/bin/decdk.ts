import fs = require('fs');
import jsiiReflect = require('jsii-reflect');
import path = require('path');
import { ConstructAndProps, resourceSchema } from '../lib/cfnschema';
import { isSerializableTypeReference } from '../lib/jsii2schema';

async function main() {
  const typeSystem = new jsiiReflect.TypeSystem();
  const packageJson = require('../package.json');

  for (const depName of Object.keys(packageJson.dependencies || {})) {
    const jsiiModuleDir = path.dirname(require.resolve(`${depName}/package.json`));
    if (!fs.existsSync(path.resolve(jsiiModuleDir, '.jsii'))) {
      continue;
    }
    await typeSystem.load(jsiiModuleDir);
  }

  // Find all constructs for which the props interface
  // (transitively) only consists of JSON primitives or interfaces
  // that consist of JSON primitives
  const constructType = typeSystem.findClass('@aws-cdk/cdk.Construct');
  const constructs = typeSystem.classes.filter(c => isSubclass(c, constructType));

  const deconstructs = constructs
    .map(unpackConstruct)
    .filter(c => c && !isCfnResource(c.constructClass)) // filter out L1s
    .filter(c => c !== undefined && isSerializableTypeReference(c.propsTypeRef)) as ConstructAndProps[];

  const baseSchema = require('../cloudformation.schema.json');

  for (const deco of deconstructs) {
    baseSchema.properties.Resources.patternProperties["^[a-zA-Z0-9]+$"].anyOf.push(resourceSchema(deco));
  }

  baseSchema.properties.$schema = {
    type: 'string'
  };

  process.stdout.write(JSON.stringify(baseSchema, undefined, 2));
}

function isSubclass(klass: jsiiReflect.ClassType, superClass: jsiiReflect.ClassType) {
  return klass.getAncestors().includes(superClass);
}

function isCfnResource(klass: jsiiReflect.ClassType) {
  const resource = klass.system.findClass('@aws-cdk/cdk.Resource');
  return (isSubclass(klass, resource));
}

function unpackConstruct(klass: jsiiReflect.ClassType): ConstructAndProps | undefined {
  if (!klass.initializer || klass.abstract) { return undefined; }
  if (klass.initializer.parameters.length < 3) { return undefined; }

  const propsParam = klass.initializer.parameters[2];
  if (propsParam.type.fqn === undefined) { return undefined; }

  return {
    constructClass: klass,
    propsTypeRef: klass.initializer.parameters[2].type
  };
}

main().catch(e => {
  // tslint:disable-next-line:no-console
  console.error(e);
  process.exit(1);
});