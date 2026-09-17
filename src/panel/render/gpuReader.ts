// Reads a rendered frame back from MapLibre's WebGL2 context, box-filtering supersampled frames on the
// GPU first, so only output-size pixels cross to the CPU.
//
// The drawing buffer is copied into a texture with a same-size blit (which also resolves MSAA), then a
// fragment shader averages each factor x factor block with texelFetch into an output-size target.
// The result matches core/render/pixels.ts downsampleBox: premultiplied RGBA8, rows bottom-up.
//
// MapLibre caches GL state and marks it all dirty at the start of every render, so changing state
// here between frames is safe.

const VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_source;
uniform int u_factor;
out vec4 fragColor;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * u_factor;
  vec4 sum = vec4(0.0);
  for (int dy = 0; dy < u_factor; dy++) {
    for (int dx = 0; dx < u_factor; dx++) sum += texelFetch(u_source, base + ivec2(dx, dy), 0);
  }
  fragColor = sum / float(u_factor * u_factor);
}`;

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };

export class GpuReader {
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private source: Target | null = null;
  private output: Target | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  /** Premultiplied RGBA8, bottom row first, at floor(drawingBuffer / factor). */
  read(factor: number): { pixels: Uint8Array; width: number; height: number } {
    const gl = this.gl;
    const canvasWidth = gl.drawingBufferWidth;
    const canvasHeight = gl.drawingBufferHeight;
    const width = Math.floor(canvasWidth / factor);
    const height = Math.floor(canvasHeight / factor);
    const pixels = new Uint8Array(width * height * 4);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
    if (factor === 1) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return { pixels, width, height };
    }

    this.source = this.target(this.source, canvasWidth, canvasHeight);
    this.output = this.target(this.output, width, height);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.source.framebuffer);
    gl.disable(gl.SCISSOR_TEST);
    gl.blitFramebuffer(0, 0, canvasWidth, canvasHeight, 0, 0, canvasWidth, canvasHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.output.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.programFor());
    gl.bindVertexArray(this.vaoFor());
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.source.texture);
    gl.uniform1i(gl.getUniformLocation(this.program!, "u_source"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program!, "u_factor"), factor);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
    gl.useProgram(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { pixels, width, height };
  }

  private target(existing: Target | null, width: number, height: number): Target {
    const gl = this.gl;
    if (existing && existing.width === width && existing.height === height) return existing;
    if (existing) {
      gl.deleteFramebuffer(existing.framebuffer);
      gl.deleteTexture(existing.texture);
    }
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`downsample target ${width}x${height} is incomplete (status ${status})`);
    return { texture, framebuffer, width, height };
  }

  private programFor(): WebGLProgram {
    if (this.program) return this.program;
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`downsample shader: ${gl.getShaderInfoLog(shader)}`);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`downsample program: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    return program;
  }

  private vaoFor(): WebGLVertexArrayObject {
    if (!this.vao) this.vao = this.gl.createVertexArray()!;
    return this.vao;
  }

  destroy(): void {
    const gl = this.gl;
    for (const t of [this.source, this.output]) {
      if (!t) continue;
      gl.deleteFramebuffer(t.framebuffer);
      gl.deleteTexture(t.texture);
    }
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.source = this.output = null;
    this.program = null;
    this.vao = null;
  }
}
