/** A completed inspection rejected the product; not a transport/equipment fault. */
export class VisionProductReject extends Error {
  constructor(message, inspectionPhase = null) {
    super(message)
    this.name = 'VisionProductReject'
    this.inspectionPhase = inspectionPhase
  }
}
