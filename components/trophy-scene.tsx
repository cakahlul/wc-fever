'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

/**
 * 3D rendition of the FIFA World Cup 26 brand mark: bold black squared
 * numerals "2" over "6" on a white card, with the golden trophy front and
 * centre. Digit outlines are hand-traced THREE.Shapes (extruded), the trophy
 * is a lathe profile — everything is code-built primitives, no asset files.
 */

const DIGIT_H = 1.4; // shape-space digit box: 1.0 wide × 1.4 tall

/** "2" — squared body, big rounded top-left corner, straight diagonal spine. */
function digit2Shape(): THREE.Shape {
  const h = DIGIT_H;
  const t = 0.42; // stroke thickness
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(1, 0);
  s.lineTo(1, t);
  s.lineTo(0.58, t); // along top of base bar to the spine's right edge
  s.lineTo(1.0, 0.8); // spine right edge up to the right stem
  s.lineTo(1.0, h);
  s.lineTo(0.42, h);
  s.quadraticCurveTo(0, h, 0, h - t); // signature rounded top-left
  s.lineTo(0.45, h - t); // underside of top bar
  s.lineTo(0, t); // spine left edge down to the base bar
  s.closePath();
  return s;
}

/** "6" — left stem + top bar + bottom bowl with a rectangular counter. */
function digit6Shape(): THREE.Shape {
  const h = DIGIT_H;
  const t = 0.3; // stroke thickness
  const bh = 0.88; // bowl height
  const tbw = 0.92; // top bar width
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(1, 0);
  s.lineTo(1, bh);
  s.lineTo(t, bh); // bowl top edge to the stem
  s.lineTo(t, h - t); // stem right edge
  s.lineTo(tbw, h - t); // top bar underside
  s.lineTo(tbw, h);
  s.lineTo(0.42, h);
  s.quadraticCurveTo(0, h, 0, h - 0.42); // rounded top-left
  s.closePath();
  const counter = new THREE.Path();
  counter.moveTo(t, t);
  counter.lineTo(1 - t, t);
  counter.lineTo(1 - t, bh - t);
  counter.lineTo(t, bh - t);
  counter.closePath();
  s.holes.push(counter);
  return s;
}

const EXTRUDE: THREE.ExtrudeGeometryOptions = {
  depth: 0.18,
  bevelEnabled: true,
  bevelThickness: 0.02,
  bevelSize: 0.02,
  bevelSegments: 2,
};

function Digit({ shape, y }: { shape: THREE.Shape; y: number }) {
  const geometry = useMemo(() => new THREE.ExtrudeGeometry(shape, EXTRUDE), [shape]);
  return (
    // shape space is 0..1 × 0..1.4 — shift x to centre the digit on the card
    <mesh geometry={geometry} position={[-0.5, y, 0]}>
      <meshStandardMaterial color="#0c0c0e" metalness={0.15} roughness={0.45} />
    </mesh>
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
      {/* malachite base bands, like the real trophy */}
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
    </group>
  );
}

function Logo26() {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const two = useMemo(digit2Shape, []);
  const six = useMemo(digit6Shape, []);

  // Gentle pendulum sway keeps the mark readable; drag layers on top.
  useFrame(({ clock }) => {
    if (group.current) {
      group.current.rotation.y = Math.sin(clock.elapsedTime * 0.5) * 0.3;
    }
  });

  const gold = hovered ? '#ffd166' : '#e8b541';
  const emissive = hovered ? 0.45 : 0.15;

  return (
    <group
      ref={group}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* white card backdrop, like the logo's lockup background */}
      <RoundedBox args={[1.7, 3.6, 0.12]} radius={0.06} position={[0, 0, -0.18]}>
        <meshStandardMaterial color="#eef2f8" roughness={0.6} metalness={0.05} />
      </RoundedBox>
      {/* stacked numerals: '2' on top, '6' below, 0.12 gap */}
      <Digit shape={two} y={0.06} />
      <Digit shape={six} y={-1.46} />
      {/* trophy front and centre, base resting in the 6's bowl region */}
      <group position={[0, -1.15, 0.62]} scale={0.7}>
        <Trophy gold={gold} emissive={emissive} />
      </group>
    </group>
  );
}

export default function TrophyScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 5.4], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 6, 6]} intensity={1.4} color="#fff6dd" />
        <pointLight position={[-4, 2, 3]} intensity={0.5} color="#3c6ff0" />
        <pointLight position={[3, -3, 3]} intensity={0.35} color="#e0413e" />
        <Float speed={1.4} rotationIntensity={0.08} floatIntensity={0.35}>
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
