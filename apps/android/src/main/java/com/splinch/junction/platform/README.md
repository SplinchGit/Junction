# Platform

## Purpose

Platform contains direct integrations with Android and privileged platform APIs that are reusable beneath user-facing features.

## Main Entry Point

- `accessibility/JunctionAccessibilityService.kt`
- `shizuku/ShizukuCapability.kt`

## Responsibilities

- expose accessibility-based screen inspection and interaction;
- wrap Bluetooth audio routing;
- provide overlay service integration;
- detect and use supported Shizuku capabilities.

## Does Not Own

- assistant planning, trust, or provider behaviour;
- feature screens and product workflows;
- Room, preferences, or synchronisation.

## Flow

feature or tool request → Android or privileged API wrapper → platform result
