# ZolTrack

**Maintenance & Asset Management System**

ZolTrack is a web-based system for school facilities that centralizes maintenance requests, inventory, asset borrowing, account approval, notifications, audit history, and operational reporting.

## Live Demo

**https://zoltrack.netlify.app**

## Highlights

- Role-based workflows for User, Admin, and Super Admin accounts
- Supabase Auth with email confirmation and profile approval
- Private verification-document storage with controlled access
- Maintenance request tracking with server-generated request IDs
- Atomic maintenance completion and inventory deduction
- Inventory and borrowing workflows with approval and return handling
- Persistent in-app notifications and audit logging
- Dashboard metrics, charts, and CSV reporting
- Responsive dark-themed interface

## Tech Stack

- HTML5, CSS3, JavaScript
- Supabase / PostgreSQL
- Supabase Auth, Storage, Row Level Security, and PostgreSQL RPC functions
- EmailJS for application notification emails
- Brevo SMTP for authentication email delivery
- Chart.js
- SweetAlert2
- Netlify

## Security Design

ZolTrack uses Supabase Row Level Security and server-side PostgreSQL functions for privileged operations. User-owned records are scoped to authenticated identities, while administrative actions validate roles server-side. Verification documents are stored in a private bucket.

> Frontend Supabase anon/publishable credentials and EmailJS public identifiers are client-visible by design. Private SMTP credentials, service-role keys, and passwords must never be committed to this repository.

## Database Migrations

The `supabase/` directory contains the staged SQL migrations used during development, including authentication migration, RLS hardening, legacy-auth retirement, atomic maintenance completion, private verification storage, persistent notifications/audit logging, and reporting functions.

## Local Use

This project is a static frontend and can be served with any local web server. The deployed application depends on its configured Supabase project and external email services.

## Author

**Jomari M. Candido**  
Sole Software Developer

## Project Status

Portfolio release — ZolTrack v9.0.
