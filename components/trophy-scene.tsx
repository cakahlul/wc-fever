'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

/**
 * 3D hero inspired by the FIFA World Cup 26 mark: the numerals "2" and "6"
 * stacked vertically with the golden trophy front and centre. Everything is
 * built from primitives in code (torus arcs + capsule strokes + lathe trophy)
 * — no external .gltf/.glb assets by design.
 */

const STROKE = 0.16; // tube radius shared by every digit stroke

interface DigitProps {
  emissiveIntensity: number;
}

function digitMaterial(emissiveIntensity: number) {
  return (
    <meshStandardMaterial
      color="#dce6f5"
      metalness={0.35}
      roughness={0.3}
      emissive="#3c6ff0"
      emissiveIntensity={emissiveIntensity * 0.25}
    />
  );
}

/** Rounded end-cap so open stroke ends look like the logo's soft terminals. */
function Cap({ x, y, e }: { x: number; y: number; e: number }) {
  return (
    <mesh position={[x, y, 0]}>
      <sphereGeometry args={[STROKE, 16, 16]} />
      {digitMaterial(e)}
    </mesh>
  );
}

/**
 * "2" — open arc bowl (240° torus), diagonal stroke, base bar.
 * Arc runs -60°…180°; the diagonal links the arc's lower-right end to the
 * left end of the base bar.
 */
function Digit2({ emissiveIntensity: e }: DigitProps) {
  // arc end (-60°) and diagonal foot, used to size/orient the diagonal stroke
  const ax = 0.42 * Math.cos(-Math.PI / 3);
  const ay = 0.42 * Math.sin(-Math.PI / 3);
  const fx = -0.4;
  const fy = -0.65;
  const len = Math.hypot(fx - ax, fy - ay);
  // rotate the cylinder's Y axis onto the stroke direction
  const theta = Math.atan2(fy - ay, fx - ax) - Math.PI / 2;

  return (
    <group>
      <mesh rotation={[0, 0, -Math.PI / 3]}>
        <torusGeometry args={[0.42, STROKE, 20, 48, (Math.PI * 4) / 3]} />
        {digitMaterial(e)}
      </mesh>
      <mesh position={[(ax + fx) / 2, (ay + fy) / 2, 0]} rotation={[0, 0, theta]}>
        <cylinderGeometry args={[STROKE, STROKE, len, 20]} />
        {digitMaterial(e)}
      </mesh>
      <mesh position={[0.025, -0.65, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[STROKE, STROKE, 0.85, 20]} />
        {digitMaterial(e)}
      </mesh>
      <Cap x={-0.42} y={0} e={e} />
      <Cap x={ax} y={ay} e={e} />
      <Cap x={fx} y={fy} e={e} />
      <Cap x={0.45} y={-0.65} e={e} />
    </group>
  );
}

/**
 * "6" — full-circle bowl plus a quarter-arc tail rising to the upper right;
 * the tail's 180° end lands exactly on the bowl's left edge so the stroke
 * reads as one continuous curve.
 */
function Digit6({ emissiveIntensity: e }: DigitProps) {
  return (
    <group>
      <mesh position={[0, -0.13, 0]}>
        <torusGeometry args={[0.42, STROKE, 20, 48]} />
        {digitMaterial(e)}
      </mesh>
      <mesh position={[0.18, -0.13, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.6, STROKE, 20, 32, Math.PI / 2]} />
        {digitMaterial(e)}
      </mesh>
      <Cap x={0.18} y={0.47} e={e} />
    </group>
  );
}

function trophyProfile(): THREE.Vector2[] {
  // (radius, height) pairs from base to globe — hand-tuned trophy silhouette
  const pts: Array<[number, number]> = [
    [0.55, 0.0],
    [0.55, 0.18],
    [0.42, 0.22],
    [0.3, 0.35],
    [0.18, 0.6],
    [0.14, 0.9],
    [0.2, 1.2],
    [0.32, 1.45],
    [0.42, 1.6],
    [0.36, 1.7],
    [0.2, 1.78],
    [0.05, 1.82],
  ];
  return pts.map(([x, y]) => new THREE.Vector2(x, y));
}

function Trophy({ gold, emissive }: { gold: string; emissive: number }) {
  const profile = useMemo(trophyProfile, []);
  return (
    <group>
      <mesh position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.62, 0.66, 0.14, 48]} />
        <meshStandardMaterial color="#0e3a2c" roughness={0.35} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.58, 0.62, 0.1, 48]} />
        <meshStandardMaterial color="#14543f" roughness={0.35} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <latheGeometry args={[profile, 64]} />
        <meshStandardMaterial
          color={gold}
          metalness={0.95}
          roughness={0.22}
          emissive={gold}
          emissiveIntensity={emissive}
        />
      </mesh>
      <mesh position={[0, 2.25, 0]}>
        <sphereGeometry args={[0.46, 48, 48]} />
        <meshStandardMaterial
          color={gold}
          metalness={0.95}
          roughness={0.18}
          emissive={gold}
          emissiveIntensity={emissive}
        />
      </mesh>
      {/* host-nation markers on the globe: USA / Canada / Mexico */}
      {[
        { color: '#3c6ff0', phi: 1.0, theta: -1.2 },
        { color: '#e0413e', phi: 0.6, theta: -1.0 },
        { color: '#1f9d55', phi: 1.3, theta: -1.35 },
      ].map((m, i) => {
        const r = 0.47;
        const x = r * Math.sin(m.phi) * Math.cos(m.theta);
        const y = 2.25 + r * Math.cos(m.phi);
        const z = r * Math.sin(m.phi) * Math.sin(m.theta);
        return (
          <mesh key={i} position={[x, y, z]}>
            <sphereGeometry args={[0.045, 16, 16]} />
            <meshStandardMaterial color={m.color} emissive={m.color} emissiveIntensity={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}

function Logo26() {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  // Gentle pendulum sway instead of a full spin — the logo stays readable
  // while still feeling alive. Drag (OrbitControls) layers on top.
  useFrame(({ clock }) => {
    if (group.current) {
      group.current.rotation.y = Math.sin(clock.elapsedTime * 0.5) * 0.35;
    }
  });

  const gold = hovered ? '#ffd166' : '#e8b541';
  const emissive = hovered ? 0.5 : 0.18;
  const digitGlow = hovered ? 1 : 0.3;

  return (
    <group
      ref={group}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* stacked numerals, slightly behind the trophy */}
      <group position={[0, 0.82, -0.1]}>
        <Digit2 emissiveIntensity={digitGlow} />
      </group>
      <group position={[0, -0.78, -0.1]}>
        <Digit6 emissiveIntensity={digitGlow} />
      </group>
      {/* trophy front and centre, spanning the full numeral stack: base
          aligned with the bottom of the 6, globe inside the 2's bowl */}
      <group position={[0, -1.45, 0.55]} scale={0.95}>
        <Trophy gold={gold} emissive={emissive} />
      </group>
    </group>
  );
}

export default function TrophyScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 5.2], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 6, 5]} intensity={1.5} color="#fff6dd" />
        <pointLight position={[-4, 2, -3]} intensity={0.7} color="#3c6ff0" />
        <pointLight position={[3, -3, 2]} intensity={0.4} color="#e0413e" />
        <Float speed={1.4} rotationIntensity={0.1} floatIntensity={0.4}>
          <Logo26 />
        </Float>
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={(2 * Math.PI) / 3}
        />
      </Suspense>
    </Canvas>
  );
}
