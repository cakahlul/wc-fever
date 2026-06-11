'use client';

import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

/**
 * World Cup trophy built entirely from primitives — a lathe-geometry cup
 * (profile approximating the swooping trophy silhouette), cylinder base and
 * a sphere "globe" crown. No external .gltf/.glb assets by design.
 */

function trophyProfile(): THREE.Vector2[] {
  // (radius, height) pairs from base to globe — hand-tuned silhouette
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

function Trophy() {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const profile = useMemo(trophyProfile, []);

  // Smooth idle rotation via the RAF loop; OrbitControls layers drag on top.
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.35;
  });

  const gold = hovered ? '#ffd166' : '#e8b541';
  const emissive = hovered ? 0.5 : 0.18;

  return (
    <group
      ref={group}
      position={[0, -1.1, 0]}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* malachite base bands */}
      <mesh position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.62, 0.66, 0.14, 48]} />
        <meshStandardMaterial color="#0e3a2c" roughness={0.35} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.58, 0.62, 0.1, 48]} />
        <meshStandardMaterial color="#14543f" roughness={0.35} metalness={0.2} />
      </mesh>
      {/* swooping golden body */}
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
      {/* the globe */}
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
            <meshStandardMaterial
              color={m.color}
              emissive={m.color}
              emissiveIntensity={0.8}
            />
          </mesh>
        );
      })}
    </group>
  );
}

export default function TrophyScene() {
  return (
    <Canvas
      camera={{ position: [0, 0.6, 4.2], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[4, 6, 4]} intensity={1.6} color="#fff6dd" />
        <pointLight position={[-4, 2, -3]} intensity={0.8} color="#3c6ff0" />
        <Float speed={1.6} rotationIntensity={0.15} floatIntensity={0.5}>
          <Trophy />
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
