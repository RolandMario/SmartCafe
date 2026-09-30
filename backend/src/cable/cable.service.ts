import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionsService } from '../transactions/transactions.service';
import { CatalogService } from '../catalog/catalog.service';
import { VendorService } from '../vendors/vendor.service';
import { UsersService } from '../users/users.service';
import { ServiceType } from '../common/enums';
import { BuyCableDto, VerifyCableDto } from './dto/cable.dto';
import {
  CableCurrentPlan,
  CableRenewal,
} from '../vendors/vendor-provider.interface';
import { firstValue, toNumber } from '../vendors/providers/cable-verify.helper';

/** One active CABLE catalog row as returned by CatalogService.getByService. */
type CablePlan = Awaited<ReturnType<CatalogService['getByService']>>[number];

@Injectable()
export class CableService {
  constructor(
    private transactionsService: TransactionsService,
    private catalogService: CatalogService,
    private vendorService: VendorService,
    private usersService: UsersService,
  ) {}

  async verify(dto: VerifyCableDto) {
    // VTPass verifies cable smart cards against a per-brand serviceID
    // (dstv | gotv | startimes), NOT a package variation code — the first
    // catalog row's productCode the old lookup returned ("dstv-padi", ...) is
    // rejected with "product does not exist". The provider enum maps 1:1.
    const result = await this.vendorService.verifyCustomer({
      serviceType: ServiceType.CABLE,
      provider: dto.provider.toLowerCase(),
      identifier: dto.smartCardNumber,
    });

    // The vendor adapters attach the customer's current subscription to
    // `extra.currentPlan` on a successful verify. Match it against our catalog
    // so the mobile app can offer a one-tap Renew that purchases the exact
    // package (catalog price + commission) the customer is already on.
    const raw = (result.extra?.currentPlan ?? null) as CableCurrentPlan | null;
    let currentPlan: CableCurrentPlan | null =
      raw && (raw.name || raw.productCode) ? { ...raw } : null;
    let renewal: CableRenewal | null = null;
    const plans = await this.catalogService.getByService(ServiceType.CABLE);

    if (currentPlan) {
      const pkg = this.matchCatalogPlan(dto.provider, currentPlan, plans);
      if (pkg) {
        // Prefer the catalog price (our sale price) over the vendor's renewal
        // amount so the confirm screen and the wallet charge always agree.
        currentPlan.amount = currentPlan.amount ?? pkg.amount ?? undefined;
        renewal = {
          packageId: String(pkg._id),
          productCode: pkg.productCode,
          name: pkg.name,
          amount: pkg.amount ?? currentPlan.amount ?? 0,
          commission: pkg.commission ?? 0,
        };
      }
    }

    // GOTV's migrated billing platform often omits the bouquet name/code
    // (Current_Bouquet: "" / Status: null) but still reports the renewal
    // amount. When the name/code couldn't resolve to a catalog plan, fall
    // back to the amount — only when exactly one plan for this provider costs
    // that amount (the same "never guess" guard as the name prefix match).
    if (!renewal) {
      const renewalAmount = firstValue(
        result.extra?.Renewal_Amount,
        result.extra?.RenewalAmount,
        result.extra?.renewal_amount,
      );
      if (renewalAmount != null) {
        const pkg = this.matchByAmount(dto.provider, renewalAmount, plans);
        if (pkg) {
          const amount = pkg.amount ?? toNumber(renewalAmount);
          currentPlan = {
            productCode: pkg.productCode,
            name: pkg.name,
            amount: amount ?? undefined,
            dueDate: firstValue(
              raw?.dueDate,
              result.extra?.Due_Date,
              result.extra?.DUE_DATE,
              result.extra?.dueDate,
              result.extra?.due_date,
            ),
          };
          renewal = {
            packageId: String(pkg._id),
            productCode: pkg.productCode,
            name: pkg.name,
            amount: amount ?? 0,
            commission: pkg.commission ?? 0,
          };
        }
      }
    }

    return {
      name: result.name,
      address: result.address,
      customerRef: result.customerRef,
      currentPlan,
      renewal,
      extra: result.extra,
    };
  }

  /** Match a verified current plan to an active CABLE catalog row — by
   *  variation code first, then by a normalised name fallback. */
  private matchCatalogPlan(
    provider: string,
    plan: CableCurrentPlan,
    plans: CablePlan[],
  ) {
    const providerKey = provider.toUpperCase();
    const byCode = plans.find(
      (p) => p.provider === providerKey && p.productCode === plan.productCode,
    );
    if (byCode) return byCode;
    if (plan.name) {
      const norm = (s: string) =>
        String(s ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');
      const target = norm(plan.name);
      const exact = plans.find(
        (p) => p.provider === providerKey && norm(p.name) === target,
      );
      if (exact) return exact;
      // VTPass bouquet names often carry a duration/add-on suffix the catalog
      // doesn't ("DStv Padi (1 Month)" → "DStv Padi"). Fall back to a prefix
      // match ONLY when exactly one catalog plan qualifies, so we never guess
      // between neighbouring plans like "DStv Compact" vs "DStv Compact Plus".
      const prefixMatches = plans.filter((p) => {
        if (p.provider !== providerKey) return false;
        const other = norm(p.name);
        if (other.length < 4 || target.length < 4) return false;
        return target.startsWith(other) || other.startsWith(target);
      });
      if (prefixMatches.length === 1) return prefixMatches[0];
    }
    return undefined;
  }

  /** Fall back to the renewal amount when VTPass omits the bouquet name/code
   *  (GOTV's migrated billing returns Current_Bouquet: "" / Status: null but
   *  still reports Renewal_Amount). Only when exactly one provider plan costs
   *  that amount — never guess between plans that share a price. */
  private matchByAmount(provider: string, amount: unknown, plans: CablePlan[]) {
    const target = toNumber(amount);
    if (!target) return undefined;
    const providerKey = provider.toUpperCase();
    const matches = plans.filter(
      (p) => p.provider === providerKey && toNumber(p.amount) === target,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  async purchase(userId: string, dto: BuyCableDto) {
    const pkg = await this.catalogService.findById(dto.packageId);
    if (pkg.service !== ServiceType.CABLE || pkg.amount == null) {
      throw new BadRequestException('Selected package is not a valid cable plan');
    }
    // VTPass requires a contact `phone` for cable purchases — use the account phone.
    const user = await this.usersService.findById(userId);
    return this.transactionsService.beginPurchase({
      userId,
      service: ServiceType.CABLE,
      amount: pkg.amount,
      description: `Cable subscription - ${pkg.providerLabel} ${pkg.name}`,
      meta: {
        provider: pkg.provider,
        providerLabel: pkg.providerLabel,
        plan: pkg.name,
        productCode: pkg.productCode,
        smartCardNumber: dto.smartCardNumber,
        phone: user?.phone ?? '',
        amount: pkg.amount,
      },
      order: {
        productCode: pkg.productCode,
        // Threads the catalog provider slug through to VTPass's buyCable so it
        // can pick the right serviceID (dstv | gotv | startimes) — the variation
        // code alone can't tell GOTV/StarTimes packages apart.
        provider: pkg.provider,
        smartCardNumber: dto.smartCardNumber,
        phone: user?.phone ?? '',
      },
      paymentWallet: dto.wallet,
      cashback: pkg.commission ?? 0,
      pin: dto.pin,
    });
  }
}