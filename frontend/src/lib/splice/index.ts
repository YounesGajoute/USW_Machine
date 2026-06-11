export * from '@/lib/splice/enums'
export * from '@/lib/splice/types'
export * from '@/lib/splice/wireColor'
export {
  buildExampleHarness,
  buildHarnessFromReference,
  harnessToSpliceJson,
} from '@/lib/splice/buildHarness'
export { layoutHarnessScene, type HarnessScene, type SceneWire } from '@/lib/splice/layoutScene'
export { drawHarness, describeHarness } from '@/lib/splice/drawHarness'
export { drawWeldSplice, drawShrinkSleeve } from '@/lib/splice/drawComponents'
export {
  harnessFromCableAssemblySpec,
  cableAssemblySpecFromHarness,
} from '@/lib/splice/harnessAdapter'
