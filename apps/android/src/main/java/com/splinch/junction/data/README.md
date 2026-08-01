# Data

## Purpose

Data contains persistent storage and synchronisation implementations: Room databases, preferences, encrypted secrets, and Firebase-backed sync.

## Main Entry Point

- `database/JunctionDatabase.kt`

## Responsibilities

- define Room entities, DAOs, and database access;
- persist preferences and provider configuration;
- store API secrets through the existing encrypted mechanism;
- synchronise supported local records with Firebase.

## Does Not Own

- assistant orchestration or feature policy;
- Compose screens;
- direct accessibility, Bluetooth, or Shizuku control.

## Flow

repository or coordinator request → local persistence and optional sync → stored or observed data
