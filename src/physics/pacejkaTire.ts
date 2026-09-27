import { type SurfaceProperties } from '../track/surfaceTypes';

export interface TireParameters {
  B: number; // Stiffness factor
  C: number; // Shape factor
  D: number; // Peak factor
  E: number; // Curvature factor
  optimalSlipAngleDeg: number;
  optimalSlipRatio: number;
}

// Period tire profiles matching the 3 eras
export const TIRE_PROFILES: Record<string, { lat: TireParameters; long: TireParameters }> = {
  // 1967 Vintage Crossply: Narrow, tall sidewalls, gentle breakaway, lower peak grip
  crossply_vintage: {
    lat: { B: 6.5, C: 1.25, D: 0.95, E: -0.8, optimalSlipAngleDeg: 9.0, optimalSlipRatio: 0.14 },
    long: { B: 7.0, C: 1.30, D: 0.98, E: -0.7, optimalSlipAngleDeg: 9.0, optimalSlipRatio: 0.14 }
  },
  // 1972 Bias-Ply Slick: Early wide slicks, moderate peak grip, progressive limit
  biasply_slick: {
    lat: { B: 9.0, C: 1.35, D: 1.15, E: -0.9, optimalSlipAngleDeg: 6.5, optimalSlipRatio: 0.11 },
    long: { B: 9.5, C: 1.40, D: 1.20, E: -0.8, optimalSlipAngleDeg: 6.5, optimalSlipRatio: 0.11 }
  },
  // 1989 Radial Slick: Wide low-profile compound, high peak grip, razor-sharp edge
  radial_slick: {
    lat: { B: 12.0, C: 1.50, D: 1.45, E: -1.1, optimalSlipAngleDeg: 4.8, optimalSlipRatio: 0.08 },
    long: { B: 13.0, C: 1.55, D: 1.50, E: -1.0, optimalSlipAngleDeg: 4.8, optimalSlipRatio: 0.08 }
  }
};

export interface TireForceResult {
  fx: number; // Longitudinal force (N)
  fy: number; // Lateral cornering force (N)
  slipAngleDeg: number;
  slipRatio: number;
  gripFraction: number; // 0..1 (1 = peak grip, <1 = sliding)
}

export class PacejkaTire {
  /**
   * Evaluates Pacejka Magic Formula: F = D * sin(C * arctan(B * x - E * (B * x - arctan(B * x))))
   */
  public static evaluateCurve(x: number, params: TireParameters): number {
    const Bx = params.B * x;
    const arctanBx = Math.atan(Bx);
    return params.D * Math.sin(params.C * Math.atan(Bx - params.E * (Bx - arctanBx)));
  }

  /**
   * Calculates combined longitudinal and lateral tire forces with friction ellipse circle
   * @param normalLoadFz Normal vertical force on wheel (N)
   * @param slipRatio Longitudinal slip ratio (-1 to +1)
   * @param slipAngleRad Lateral slip angle (radians)
   * @param surface Active track surface properties (friction multiplier)
   * @param tireType Tire compound identifier
   */
  public static calculateCombinedForces(
    normalLoadFz: number,
    slipRatio: number,
    slipAngleRad: number,
    surface: SurfaceProperties,
    tireType: string = 'radial_slick'
  ): TireForceResult {
    if (normalLoadFz <= 0) {
      return { fx: 0, fy: 0, slipAngleDeg: 0, slipRatio: 0, gripFraction: 0 };
    }

    const profile = TIRE_PROFILES[tireType] || TIRE_PROFILES.radial_slick;
    const slipAngleDeg = slipAngleRad * (180 / Math.PI);

    // 1. Pure Longitudinal Force
    const normalizedLongForce = this.evaluateCurve(slipRatio, profile.long);
    let pureFx = normalizedLongForce * normalLoadFz * surface.frictionMultiplier;

    // 2. Pure Lateral Force
    const normalizedLatForce = this.evaluateCurve(slipAngleRad, profile.lat);
    let pureFy = -normalizedLatForce * normalLoadFz * surface.frictionMultiplier;

    // 3. Combined Slip Friction Ellipse (Brunner & Fiala ellipse coupling)
    // Limits total traction circle to mu * Fz
    const maxFx = normalLoadFz * surface.frictionMultiplier * profile.long.D;
    const maxFy = normalLoadFz * surface.frictionMultiplier * profile.lat.D;

    // Elliptical combined scaling
    const normalizedX = pureFx / (maxFx + 1e-4);
    const normalizedY = pureFy / (maxFy + 1e-4);
    const vectorLength = Math.hypot(normalizedX, normalizedY);

    let fx = pureFx;
    let fy = pureFy;
    let gripFraction = 1.0;

    if (vectorLength > 1.0) {
      fx = pureFx / vectorLength;
      fy = pureFy / vectorLength;
      gripFraction = 1.0 / vectorLength;
    }

    return {
      fx,
      fy,
      slipAngleDeg,
      slipRatio,
      gripFraction: Math.max(0, Math.min(1, gripFraction))
    };
  }
}
