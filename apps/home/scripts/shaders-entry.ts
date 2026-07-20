// Entry for the vendored Paper Shaders bundle (see moon task
// home:bundle-shaders). Only the surface the status badges use — bundling
// the package's full re-export index tree-shakes incorrectly under bun and
// produces a broken module, so the entry names each export explicitly.
export {
  defaultObjectSizing,
  getShaderColorFromString,
  getShaderNoiseTexture,
  PulsingBorderAspectRatios,
  pulsingBorderFragmentShader,
  ShaderFitOptions,
  ShaderMount,
} from '@paper-design/shaders';
