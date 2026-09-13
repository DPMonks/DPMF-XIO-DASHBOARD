import {openExternalUrl} from "../xaman/xappHost";
import {useI18n} from "../i18n/useI18n";

const SITE_URL = "https://dpmf.technology";
const COMMUNITY_URL = "https://t.me/DPMF_XIO";

function FooterLink({ href, children }) {
  return (
    <a
      className="footer-link"
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        openExternalUrl(href);
      }}
    >
      {children}
    </a>
  );
}

export default function Footer() {
  const { t, country, lang } = useI18n();

  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <strong>DPMF</strong>
        <span>{t.footerTagline}</span>
      </div>
      <p className="footer-about">{t.footerAbout}</p>
      <div className="footer-links">
        <FooterLink href={SITE_URL}>{t.footerSite}</FooterLink>
        <FooterLink href={COMMUNITY_URL}>{t.footerCommunity}</FooterLink>
      </div>
      {country && (
        <p className="footer-locale">
          {t.detected}: {country} · {lang.toUpperCase()}
        </p>
      )}
    </footer>
  );
}
