/**
 * SDK Telemetry
 *
 * Auto-detects runtime environment and SDK metadata.
 * Follows OpenTelemetry semantic conventions.
 */

import type { SDKTelemetry, ServiceConfig } from './types';

// SDK metadata (injected at build time or from package.json)
const SDK_NAME = '@lelemondev/sdk';
const SDK_VERSION = '__SDK_VERSION__'; // Replaced by build script or fallback
const SDK_LANGUAGE = 'nodejs';

// ─────────────────────────────────────────────────────────────
// Runtime Detection
// ─────────────────────────────────────────────────────────────

interface RuntimeInfo {
  name: string;
  version: string;
}

function detectRuntime(): RuntimeInfo | null {
  // Node.js
  if (typeof process !== 'undefined' && process.versions?.node) {
    return {
      name: 'nodejs',
      version: process.versions.node,
    };
  }

  // Deno
  if (typeof Deno !== 'undefined') {
    return {
      name: 'deno',
      version: (Deno as { version?: { deno?: string } }).version?.deno ?? 'unknown',
    };
  }

  // Bun
  if (typeof Bun !== 'undefined') {
    return {
      name: 'bun',
      version: (Bun as { version?: string }).version ?? 'unknown',
    };
  }

  // Browser
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
    return {
      name: 'browser',
      version: navigator.userAgent,
    };
  }

  return null;
}

function detectOS(): string | null {
  // Node.js
  if (typeof process !== 'undefined' && process.platform) {
    const platform = process.platform;
    switch (platform) {
      case 'darwin':
        return 'darwin';
      case 'win32':
        return 'windows';
      case 'linux':
        return 'linux';
      default:
        return platform;
    }
  }

  // Browser - try to detect from userAgent
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) return 'darwin';
    if (ua.includes('win')) return 'windows';
    if (ua.includes('linux')) return 'linux';
  }

  return null;
}

function getSDKVersion(): string {
  // If version was injected at build time
  if (SDK_VERSION !== '__SDK_VERSION__') {
    return SDK_VERSION;
  }

  // Try to read from package.json in Node.js
  try {
    // Dynamic import to avoid bundler issues
    if (typeof require !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('../../package.json');
      return pkg.version ?? 'unknown';
    }
  } catch {
    // Ignore - package.json not available
  }

  return 'unknown';
}

// ─────────────────────────────────────────────────────────────
// Telemetry Builder
// ─────────────────────────────────────────────────────────────

let cachedTelemetry: SDKTelemetry | null = null;

/**
 * Build SDK telemetry object with auto-detected values
 */
export function buildTelemetry(service?: ServiceConfig): SDKTelemetry {
  // Cache the auto-detected values
  if (!cachedTelemetry) {
    const runtime = detectRuntime();
    const os = detectOS();

    cachedTelemetry = {
      'telemetry.sdk.name': SDK_NAME,
      'telemetry.sdk.version': getSDKVersion(),
      'telemetry.sdk.language': SDK_LANGUAGE,
    };

    if (runtime) {
      cachedTelemetry['process.runtime.name'] = runtime.name;
      cachedTelemetry['process.runtime.version'] = runtime.version;
    }

    if (os) {
      cachedTelemetry['os.type'] = os;
    }
  }

  // Merge with service config
  const telemetry: SDKTelemetry = { ...cachedTelemetry };

  if (service?.name) {
    telemetry['service.name'] = service.name;
  }
  if (service?.version) {
    telemetry['service.version'] = service.version;
  }
  if (service?.environment) {
    telemetry['deployment.environment'] = service.environment;
  }

  return telemetry;
}

/**
 * Reset cached telemetry (for testing)
 */
export function resetTelemetryCache(): void {
  cachedTelemetry = null;
}

// Type declarations for runtime detection
declare const Deno: unknown;
declare const Bun: unknown;
declare const window: unknown;
declare const navigator: { userAgent: string } | undefined;
