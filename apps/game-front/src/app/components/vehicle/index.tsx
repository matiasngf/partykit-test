/** Inspired by https://github.com/isaac-mason/sketches/blob/main/sketches/rapier/arcade-vehicle-controller/src/sketch.tsx */

import { useKeyboardControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BallCollider,
  RapierRigidBody,
  RigidBody,
  RigidBodyProps,
  useBeforePhysicsStep,
  useRapier,
} from "@react-three/rapier";
import { forwardRef, useMemo, useRef } from "react";
import * as THREE from "three";
import { GameControls } from "../game";

const up = new THREE.Vector3(0, 1, 0);
const maxForwardSpeed = 5;
const maxReverseSpeed = -4;

// Car dimensions
const CAR = {
  WIDTH: 0.1,
  HEIGHT: 0.08,
  LENGTH: 0.2,
  MASS: 2,
  COLLIDER_RADIUS: 0.1,
} as const;

// Wheel properties
const WHEEL = {
  RADIUS: 0.03,
  WIDTH: 0.03,
  HEIGHT_OFFSET: -0.06,
  FRONT_OFFSET: -0.1,
  REAR_OFFSET: 0.1,
  SIDE_OFFSET: 0.07,
} as const;

const CAMERA = {
  position: new THREE.Vector3(0, 0.06, 0.4),
  lookAt: new THREE.Vector3(0, 0.07, 0),
};

const wheels = [
  // front
  {
    position: new THREE.Vector3(
      -WHEEL.SIDE_OFFSET,
      WHEEL.HEIGHT_OFFSET,
      WHEEL.FRONT_OFFSET
    ),
  },
  {
    position: new THREE.Vector3(
      WHEEL.SIDE_OFFSET,
      WHEEL.HEIGHT_OFFSET,
      WHEEL.FRONT_OFFSET
    ),
  },
  // rear
  {
    position: new THREE.Vector3(
      -WHEEL.SIDE_OFFSET,
      WHEEL.HEIGHT_OFFSET,
      WHEEL.REAR_OFFSET
    ),
  },
  {
    position: new THREE.Vector3(
      WHEEL.SIDE_OFFSET,
      WHEEL.HEIGHT_OFFSET,
      WHEEL.REAR_OFFSET
    ),
  },
];

const _bodyPosition = new THREE.Vector3();
const _bodyEuler = new THREE.Euler();
const _cameraPosition = new THREE.Vector3();
const _impulse = new THREE.Vector3();

interface VehicleVectors {
  wheelRotation: { current: number };
  steeringInput: { current: number };
}

export const Car = forwardRef<THREE.Group, RigidBodyProps>((props, ref) => {
  const { rapier, world } = useRapier();

  const bodyRef = useRef<RapierRigidBody>(null!);
  const groupRef = useRef<THREE.Group>(null!);

  const vectors = useMemo(
    () => ({
      wheelRotation: { current: 0 },
      steeringInput: { current: 0 },
    }),
    []
  );

  const steeringAngle = useRef(0);
  const steeringAngleQuat = useRef(new THREE.Quaternion());

  const driftSteeringAngle = useRef(0);

  const driftingLeft = useRef(false);
  const driftingRight = useRef(false);
  const driftSteeringVisualAngle = useRef(0);

  const speed = useRef(0);
  const grounded = useRef(false);

  const [, getKeyboardControls] = useKeyboardControls<GameControls>();

  useBeforePhysicsStep(() => {
    const controls = getKeyboardControls();
    const { forward, back, left, right, drift } = controls;

    const impulse = _impulse.set(0, 0, -speed.current).multiplyScalar(5);

    // check if grounded
    const groundRayResult = world.castRay(
      new rapier.Ray(bodyRef.current.translation(), { x: 0, y: -1, z: 0 }),
      1,
      false,
      undefined,
      undefined,
      undefined,
      bodyRef.current
    );
    grounded.current = groundRayResult !== null;

    // steering angle
    vectors.steeringInput.current = Number(left) - Number(right);
    // udpate angle based on direction
    if (impulse.z > 0) {
      vectors.steeringInput.current *= -1;
    }

    // update vehicle angle
    steeringAngle.current += vectors.steeringInput.current * 0.02;

    // drifting controls
    if (!drift) {
      driftingLeft.current = false;
      driftingRight.current = false;
    }

    if (drift && grounded.current && 1 < speed.current) {
      if (left) {
        driftingLeft.current = true;
      }

      if (right) {
        driftingRight.current = true;
      }

      if (
        (driftingLeft.current && driftingRight.current) ||
        (!left && !right)
      ) {
        driftingLeft.current = false;
        driftingRight.current = false;
      }
    } else {
      driftingLeft.current = false;
      driftingRight.current = false;
    }

    // drift steering
    let driftSteeringTarget = 0;

    if (driftingLeft.current) {
      driftSteeringTarget = 1;
    } else if (driftingRight.current) {
      driftSteeringTarget = -1;
    }

    driftSteeringAngle.current = THREE.MathUtils.lerp(
      driftSteeringAngle.current,
      driftSteeringTarget,
      0.5
    );

    steeringAngle.current += driftSteeringAngle.current * 0.01;

    steeringAngleQuat.current.setFromAxisAngle(up, steeringAngle.current);

    impulse.applyQuaternion(steeringAngleQuat.current);

    // acceleration and deceleration
    let speedTarget = 0;

    if (forward) {
      speedTarget = maxForwardSpeed;
    } else if (back) {
      speedTarget = maxReverseSpeed;
    }

    speed.current = THREE.MathUtils.lerp(speed.current, speedTarget, 0.03);

    // apply impulse
    if (impulse.length() > 0) {
      bodyRef.current.applyImpulse(impulse, true);
    }

    // damping
    bodyRef.current.applyImpulse(
      {
        x: -bodyRef.current.linvel().x * 1.5,
        y: 0,
        z: -bodyRef.current.linvel().z * 1.5,
      },
      true
    );
  });

  const camera = useThree((state) => state.camera);

  useFrame((_, delta) => {
    // body position
    if (!bodyRef.current) return;
    const bodyPosition = _bodyPosition.copy(bodyRef.current.translation());
    groupRef.current.position.copy(bodyPosition);
    groupRef.current.quaternion.copy(steeringAngleQuat.current);
    groupRef.current.updateMatrix();

    // drift visual angle
    driftSteeringVisualAngle.current = THREE.MathUtils.lerp(
      driftSteeringVisualAngle.current,
      driftSteeringAngle.current,
      delta * 10
    );

    // body rotation
    const bodyEuler = _bodyEuler.setFromQuaternion(
      groupRef.current.quaternion,
      "YXZ"
    );
    bodyEuler.y = bodyEuler.y + driftSteeringVisualAngle.current * 0.4;
    groupRef.current.rotation.copy(bodyEuler);

    // wheel rotation
    vectors.wheelRotation.current -= (speed.current / 10) * delta * 100;

    // camera
    if (true) {
      const cameraPosition = _cameraPosition.copy(bodyPosition).add({
        x: 1,
        y: 1,
        z: 1,
      });
      camera.position.copy(cameraPosition);
      camera.lookAt(bodyPosition.clone().add(CAMERA.lookAt));
    }
  });

  return (
    <>
      {/* body */}
      <RigidBody
        {...props}
        ref={bodyRef}
        colliders={false}
        mass={CAR.MASS}
        ccd
        name="player"
        type="dynamic"
      >
        <BallCollider args={[CAR.COLLIDER_RADIUS]} mass={CAR.MASS} />
      </RigidBody>

      {/* vehicle */}
      <group ref={groupRef}>
        <group ref={ref}>
          <CarBody v={vectors} />
        </group>
      </group>
    </>
  );
});

export const CarBody = forwardRef<THREE.Group, { v: VehicleVectors }>(
  ({ v }, ref) => {
    const wheelsRef = useRef<(THREE.Object3D | null)[]>([]);

    useFrame(() => {
      wheelsRef.current.forEach((wheel) => {
        if (!wheel) return;

        wheel.rotation.order = "YXZ";
        wheel.rotation.x = v.wheelRotation.current;
      });

      wheelsRef.current[1]!.rotation.y = v.steeringInput.current * 0.5;
      wheelsRef.current[0]!.rotation.y = v.steeringInput.current * 0.5;
    });

    return (
      <group ref={ref}>
        <mesh>
          <boxGeometry args={[CAR.WIDTH, CAR.HEIGHT, CAR.LENGTH]} />
          <meshBasicMaterial color="#fff" />
        </mesh>

        {wheels.map((wheel, index) => (
          <group
            key={index}
            ref={(ref) => (wheelsRef.current[index] = ref)}
            position={wheel.position}
          >
            <group rotation-z={-Math.PI / 2}>
              <mesh>
                <cylinderGeometry
                  args={[WHEEL.RADIUS, WHEEL.RADIUS, WHEEL.WIDTH, 16]}
                />
                <meshStandardMaterial color="#222" />
              </mesh>
              <mesh scale={1.01}>
                <cylinderGeometry
                  args={[WHEEL.RADIUS, WHEEL.RADIUS, WHEEL.WIDTH, 6]}
                />
                <meshStandardMaterial color="#fff" wireframe />
              </mesh>
            </group>
          </group>
        ))}
      </group>
    );
  }
);

CarBody.displayName = "CarBody";

Car.displayName = "Car";
