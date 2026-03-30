import './globals.css';

export const metadata = {
  title: 'OfferGuard - Royal LePage Prime',
  description: 'Broker Compliance Review Tool',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
