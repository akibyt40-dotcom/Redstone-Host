# Redstone Host

A starter web app for the Redstone Host customer portal.

## Included
- Login with email **or** username and password
- Registration for customer accounts
- Password hashing with bcrypt
- Session-based authentication and basic login rate limiting
- Dynamic `Welcome back, [Username]!`
- Dashboard, My Servers, Plans, Billing, Support and Settings pages
- Seven plans: Stone (2 GB free), Iron (3 GB / ৳195), Gold (4 GB / ৳390), Diamond (5 GB / ৳585), Netherite (6 GB / ৳780), Emerald (7 GB / ৳975), Redstone (8 GB / ৳1,170)
- Monthly and quarterly pricing toggle (quarterly currently equals 3× monthly)
- Deploying a plan creates an order and a customer support ticket automatically\n- Customer/admin ticket messaging for payment instructions, transaction details and setup updates\n- Admin ticket inbox with status controls (open, waiting customer, paid, approved, closed)\n- Order requests require admin approval
- Manual server setup only: approving an order creates a pending server record; it does not provision a Minecraft server
- Admin order approval/rejection page (visible only to admin accounts)

## Run locally
1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Set a long random `SESSION_SECRET`.
4. Set `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `.env`.
5. Run `npm install`, then `npm start`.
6. Open `http://localhost:3000`.

The first admin is created on first start only when the three admin environment variables are set. Password is hashed before storage. Keep `.env` private and never upload it to a public repository.

## Important before public deployment
- Use HTTPS and a production-grade session store (the default in-memory session store is for local testing only).
- Configure OAuth credentials and callback routes before enabling Discord/Google sign-in. The buttons currently explain that OAuth is not configured; they do not authenticate users yet.
- Add a real payment gateway and payment verification before approving paid orders.
- Configure backups, monitoring, email verification, password reset, CSRF protection and a production database.
- No Minecraft server is automatically created. Actual server provisioning must be performed manually outside this app.
