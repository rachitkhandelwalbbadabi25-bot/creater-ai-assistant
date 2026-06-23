import * as ONNX_NODE from "onnxruntime-node";

console.log({
  keys: Object.keys(ONNX_NODE),
  hasEnv: !!ONNX_NODE.env,
});
