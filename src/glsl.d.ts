// Shader module declarations so TypeScript treats imported GLSL as strings.
declare module '*.glsl' {
  const value: string
  export default value
}
declare module '*.vert' {
  const value: string
  export default value
}
declare module '*.frag' {
  const value: string
  export default value
}
