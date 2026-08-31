/**
 * `_sitemap` est une route générée par expo-router : elle liste TOUS les
 * écrans de l'app. Elle reste embarquée dans les builds de production, et
 * l'écran « Unmatched Route » y renvoyait en un tap — un membre tombé sur un
 * lien profond cassé se retrouvait donc devant l'arborescence interne.
 *
 * On la neutralise en la redéfinissant : un fichier de l'app a priorité sur la
 * route générée.
 */
import { Redirect } from 'expo-router';

export default function SitemapDisabled() {
  return <Redirect href="/" />;
}
