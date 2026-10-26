"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/*
 * =====================================================
 * TYPES
 * =====================================================
 */

type ProductImage = {
  id: string;
  image_url: string;
  sort_order: number;
  is_primary: boolean;
};

type Product = {
  id: string;
  title: string;
  description: string | null;
  sku: string;
  price: number | string;
  quantity: number;
  status: string;
  category: string | null;
  product_images: ProductImage[];
};

type ListingAttribute = {
  name: string;
  value: string;
};

type ListingDraft = {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  attributes: ListingAttribute[];
  needsConfirmation: string[];
  price: number;
  status: string;
};

type EbayConditionDescriptorValue = {
  valueId: string;
  valueName: string;
};

type EbayConditionDescriptor = {
  descriptorId: string;
  name: string;
  required: boolean;
  mode: string | string[] | null;
  values: EbayConditionDescriptorValue[];
};

type EbayConditionOption = {
  conditionId: string;
  conditionDescription: string;
  conditionHelpText: string;
  inventoryCondition: string | null;
  descriptors: EbayConditionDescriptor[];
};

type EbayPreparation = {
  published: boolean;

  product: {
    id: string;
    sku: string;
    quantity: number;
  };

  approvedListing: {
    draftId: string;
    title: string;
    description: string;
    category: string;
    condition: string;
    attributes: ListingAttribute[];
    price: number;
  };

  ebay: {
    marketplaceId: string;
    categoryTreeId: string;

    suggestedCategory: {
      categoryId: string;
      categoryName: string;
    };

    categoryAlternatives: {
      categoryId: string;
      categoryName: string;
    }[];

    requiredAspects: {
      name: string;
      mode?: string | null;
      values: string[];
    }[];

    conditionOptions: EbayConditionOption[];

    conditionPolicy: any;
  };
};

type EbayPublishedListing = {
  offerId: string;
  listingId: string;
  listingUrl: string;
};

/*
 * =====================================================
 * PAGE
 * =====================================================
 */

export default function GenerateListingPage() {
  /*
   * =====================================================
   * CENTRAL PRODUCT STATE
   * =====================================================
   */

  const [products, setProducts] = useState<Product[]>([]);

  const [selectedProductId, setSelectedProductId] =
    useState("");

  const [quantityInput, setQuantityInput] =
    useState("");

  const [savingQuantity, setSavingQuantity] =
    useState(false);

  /*
   * =====================================================
   * AI LISTING STATE
   * =====================================================
   */

  const [result, setResult] =
    useState<ListingDraft | null>(null);

  const [loadingProducts, setLoadingProducts] =
    useState(true);

  const [generating, setGenerating] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [
    confirmationReviewed,
    setConfirmationReviewed,
  ] = useState(false);

  /*
   * =====================================================
   * EBAY STATE
   * =====================================================
   */

  const [preparingEbay, setPreparingEbay] =
    useState(false);

  const [
    ebayPreparation,
    setEbayPreparation,
  ] = useState<EbayPreparation | null>(null);

  const [
    selectedEbayCategoryId,
    setSelectedEbayCategoryId,
  ] = useState("");

  const [
    ebayAspectSelections,
    setEbayAspectSelections,
  ] = useState<Record<string, string>>({});

  const [
    selectedEbayConditionId,
    setSelectedEbayConditionId,
  ] = useState("");

  const [
    ebayDescriptorSelections,
    setEbayDescriptorSelections,
  ] = useState<Record<string, string>>({});

  const [
    publishingEbay,
    setPublishingEbay,
  ] = useState(false);

  const [
    ebayPublishedListing,
    setEbayPublishedListing,
  ] = useState<EbayPublishedListing | null>(
    null
  );

  /*
   * =====================================================
   * SELECTED PRODUCT
   * =====================================================
   */

  const selectedProduct = useMemo(() => {
    return products.find(
      (product) =>
        product.id === selectedProductId
    );
  }, [products, selectedProductId]);

  /*
   * =====================================================
   * SORT PRODUCT IMAGES
   * =====================================================
   */

  const selectedImages = useMemo(() => {
    if (!selectedProduct?.product_images) {
      return [];
    }

    return [
      ...selectedProduct.product_images,
    ].sort((a, b) => {
      if (
        a.is_primary &&
        !b.is_primary
      ) {
        return -1;
      }

      if (
        !a.is_primary &&
        b.is_primary
      ) {
        return 1;
      }

      return (
        a.sort_order -
        b.sort_order
      );
    });
  }, [selectedProduct]);

  /*
   * =====================================================
   * SELECTED EBAY CONDITION
   * =====================================================
   */

  const selectedEbayCondition =
    useMemo(() => {
      if (
        !ebayPreparation ||
        !selectedEbayConditionId
      ) {
        return null;
      }

      return (
        ebayPreparation.ebay.conditionOptions.find(
          (condition) =>
            condition.conditionId ===
            selectedEbayConditionId
        ) ?? null
      );
    }, [
      ebayPreparation,
      selectedEbayConditionId,
    ]);

  /*
   * =====================================================
   * EBAY PUBLISH VALIDATION
   * =====================================================
   */

  const ebayPublishValidation =
    useMemo(() => {
      if (
        !ebayPreparation ||
        !selectedEbayCategoryId ||
        !selectedEbayCondition
      ) {
        return {
          ready: false,

          missing: [
            "Complete the eBay preparation settings.",
          ],
        };
      }

      const missing: string[] = [];

      /*
       * Required eBay item specifics.
       */
      for (
        const aspect of
        ebayPreparation.ebay.requiredAspects
      ) {
        const value =
          ebayAspectSelections[
            aspect.name
          ]?.trim();

        if (!value) {
          missing.push(
            `Item specific: ${aspect.name}`
          );
        }
      }

      /*
       * Required eBay condition descriptors.
       */
      for (
        const descriptor of
        selectedEbayCondition.descriptors
      ) {
        if (!descriptor.required) {
          continue;
        }

        const value =
          ebayDescriptorSelections[
            descriptor.descriptorId
          ]?.trim();

        if (!value) {
          missing.push(
            `Condition detail: ${descriptor.name}`
          );
        }
      }

      return {
        ready:
          missing.length === 0,

        missing,
      };
    }, [
      ebayPreparation,
      selectedEbayCategoryId,
      selectedEbayCondition,
      ebayAspectSelections,
      ebayDescriptorSelections,
    ]);

  /*
   * =====================================================
   * CLEAR EBAY PREPARATION
   * =====================================================
   */

  function clearEbayPreparation() {
    setEbayPreparation(null);

    setSelectedEbayCategoryId("");

    setEbayAspectSelections({});

    setSelectedEbayConditionId("");

    setEbayDescriptorSelections({});

    setEbayPublishedListing(null);
  }

  /*
   * =====================================================
   * LOAD PRODUCTS
   * =====================================================
   */

  useEffect(() => {
    async function loadProducts() {
      setLoadingProducts(true);
      setError("");

      const supabase =
        createClient();

      const {
        data,
        error: productsError,
      } = await supabase
        .from("products")
        .select(`
          id,
          title,
          description,
          sku,
          price,
          quantity,
          status,
          category,
          product_images (
            id,
            image_url,
            sort_order,
            is_primary
          )
        `)
        .order(
          "created_at",
          {
            ascending: false,
          }
        );

      if (productsError) {
        console.error(
          productsError
        );

        setError(
          "Could not load your ListNexus products."
        );

        setLoadingProducts(false);

        return;
      }

      const loadedProducts =
        (data ?? []) as Product[];

      setProducts(
        loadedProducts
      );

      if (
        loadedProducts.length > 0
      ) {
        setSelectedProductId(
          loadedProducts[0].id
        );
      }

      setLoadingProducts(false);
    }

    loadProducts();
  }, []);

  /*
   * =====================================================
   * KEEP QUANTITY INPUT SYNCED
   * =====================================================
   */

  useEffect(() => {
    if (selectedProduct) {
      setQuantityInput(
        selectedProduct.quantity.toString()
      );
    }
  }, [selectedProduct]);

  /*
   * =====================================================
   * RESTORE LATEST SAVED LISTING DRAFT
   * =====================================================
   */

  useEffect(() => {
    async function loadLatestDraft() {
      if (!selectedProduct) {
        setResult(null);

        return;
      }

      const supabase =
        createClient();

      const {
        data: draft,
        error: draftError,
      } = await supabase
        .from("listing_drafts")
        .select(`
          id,
          generated_title,
          generated_description,
          generated_category,
          generated_condition,
          generated_attributes,
          suggested_price,
          needs_confirmation,
          status,
          created_at
        `)
        .eq(
          "product_id",
          selectedProduct.id
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        )
        .limit(1)
        .maybeSingle();

      if (draftError) {
        console.error(
          "Could not load saved listing draft:",
          draftError
        );

        return;
      }

      if (!draft) {
        setResult(null);

        setConfirmationReviewed(
          false
        );

        clearEbayPreparation();

        return;
      }

      setResult({
        id:
          draft.id,

        title:
          draft.generated_title ??
          "",

        description:
          draft.generated_description ??
          "",

        category:
          draft.generated_category ??
          "",

        condition:
          draft.generated_condition ??
          "",

        attributes:
          draft.generated_attributes ??
          [],

        needsConfirmation:
          draft.needs_confirmation ??
          [],

        price:
          Number(
            draft.suggested_price
          ),

        status:
          draft.status,
      });

      setConfirmationReviewed(
        draft.status ===
          "APPROVED"
      );

      clearEbayPreparation();
    }

    loadLatestDraft();
  }, [selectedProduct]);

  /*
   * =====================================================
   * SAVE CENTRAL QUANTITY
   * =====================================================
   */

  async function handleSaveQuantity() {
    if (!selectedProduct) {
      return;
    }

    const newQuantity =
      Number(quantityInput);

    if (
      !Number.isInteger(
        newQuantity
      ) ||
      newQuantity < 0
    ) {
      setError(
        "Quantity must be a whole number that is 0 or greater."
      );

      return;
    }

    setSavingQuantity(true);

    setError("");
    setMessage("");

    const supabase =
      createClient();

    let newStatus =
      selectedProduct.status;

    if (
      newQuantity === 0 &&
      selectedProduct.status ===
        "AVAILABLE"
    ) {
      newStatus =
        "SOLD_OUT";
    }

    if (
      newQuantity > 0 &&
      selectedProduct.status ===
        "SOLD_OUT"
    ) {
      newStatus =
        "AVAILABLE";
    }

    const {
      data: updatedProduct,
      error: quantityError,
    } = await supabase
      .from("products")
      .update({
        quantity:
          newQuantity,

        status:
          newStatus,

        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        selectedProduct.id
      )
      .select(`
        id,
        quantity,
        status
      `)
      .single();

    if (
      quantityError ||
      !updatedProduct
    ) {
      console.error(
        quantityError
      );

      setError(
        "ListNexus could not update the product quantity."
      );

      setSavingQuantity(false);

      return;
    }

    setProducts(
      (currentProducts) =>
        currentProducts.map(
          (product) =>
            product.id ===
            selectedProduct.id
              ? {
                  ...product,

                  quantity:
                    updatedProduct.quantity,

                  status:
                    updatedProduct.status,
                }
              : product
        )
    );

    setQuantityInput(
      updatedProduct.quantity.toString()
    );

    /*
     * Old eBay preview now has stale quantity.
     */
    clearEbayPreparation();

    setMessage(
      `Available quantity updated to ${updatedProduct.quantity}.`
    );

    setSavingQuantity(false);
  }

  /*
   * =====================================================
   * CHANGE PRODUCT
   * =====================================================
   */

  function handleProductChange(
    productId: string
  ) {
    setSelectedProductId(
      productId
    );

    setResult(null);

    setError("");
    setMessage("");

    setConfirmationReviewed(
      false
    );

    clearEbayPreparation();
  }

  /*
   * =====================================================
   * GENERATE AI LISTING
   * =====================================================
   */

  async function handleGenerate() {
    if (!selectedProduct) {
      setError(
        "Please select a ListNexus product."
      );

      return;
    }

    if (
      selectedImages.length === 0
    ) {
      setError(
        "This product needs at least one image before AI can analyze it."
      );

      return;
    }

    setGenerating(true);

    setError("");
    setMessage("");

    setResult(null);

    setConfirmationReviewed(
      false
    );

    clearEbayPreparation();

    try {
      const response =
        await fetch(
          "/api/ai",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              productId:
                selectedProduct.id,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Something went wrong while generating the listing."
        );
      }

      const listing =
        data.listing as ListingDraft;

      setResult({
        ...listing,

        price:
          Number(
            listing.price
          ),
      });

      setMessage(
        "AI listing draft generated. Review and edit anything you want before approving it."
      );
    } catch (
      generateError
    ) {
      if (
        generateError instanceof Error
      ) {
        setError(
          generateError.message
        );
      } else {
        setError(
          "Something went wrong while generating the listing."
        );
      }
    } finally {
      setGenerating(false);
    }
  }

  /*
   * =====================================================
   * UPDATE LISTING FIELD
   * =====================================================
   */

  function updateResultField<
    K extends keyof ListingDraft
  >(
    field: K,
    value: ListingDraft[K]
  ) {
    setResult(
      (current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,

          [field]:
            value,

          /*
           * Editing an approved listing means
           * it must be approved again.
           */
          status:
            current.status ===
            "APPROVED"
              ? "GENERATED"
              : current.status,
        };
      }
    );

    setMessage("");

    clearEbayPreparation();
  }

  /*
   * =====================================================
   * UPDATE ATTRIBUTE
   * =====================================================
   */

  function updateAttribute(
    index: number,
    field: "name" | "value",
    value: string
  ) {
    setResult(
      (current) => {
        if (!current) {
          return current;
        }

        const attributes =
          [
            ...current.attributes,
          ];

        attributes[index] = {
          ...attributes[index],

          [field]:
            value,
        };

        return {
          ...current,

          attributes,

          status:
            current.status ===
            "APPROVED"
              ? "GENERATED"
              : current.status,
        };
      }
    );

    setMessage("");

    clearEbayPreparation();
  }

  /*
   * =====================================================
   * ADD ATTRIBUTE
   * =====================================================
   */

  function addAttribute() {
    setResult(
      (current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,

          attributes: [
            ...current.attributes,

            {
              name: "",
              value: "",
            },
          ],

          status:
            current.status ===
            "APPROVED"
              ? "GENERATED"
              : current.status,
        };
      }
    );

    setMessage("");

    clearEbayPreparation();
  }

  /*
   * =====================================================
   * REMOVE ATTRIBUTE
   * =====================================================
   */

  function removeAttribute(
    indexToRemove: number
  ) {
    setResult(
      (current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,

          attributes:
            current.attributes.filter(
              (_, index) =>
                index !==
                indexToRemove
            ),

          status:
            current.status ===
            "APPROVED"
              ? "GENERATED"
              : current.status,
        };
      }
    );

    setMessage("");

    clearEbayPreparation();
  }

  /*
   * =====================================================
   * APPROVE LISTING DRAFT
   * =====================================================
   */

  async function handleApproveDraft() {
    if (!result) {
      return;
    }

    if (
      !result.title.trim()
    ) {
      setError(
        "Listing title cannot be empty."
      );

      return;
    }

    if (
      !result.description.trim()
    ) {
      setError(
        "Listing description cannot be empty."
      );

      return;
    }

    if (
      !result.category.trim()
    ) {
      setError(
        "Please enter a listing category."
      );

      return;
    }

    if (
      !result.condition.trim()
    ) {
      setError(
        "Please enter or confirm the item condition."
      );

      return;
    }

    if (
      !Number.isFinite(
        result.price
      ) ||
      result.price <= 0
    ) {
      setError(
        "Listing price must be greater than $0."
      );

      return;
    }

    const cleanedAttributes =
      result.attributes.filter(
        (attribute) =>
          attribute.name.trim() !==
            "" &&
          attribute.value.trim() !==
            ""
      );

    if (
      result.needsConfirmation
        .length > 0 &&
      !confirmationReviewed
    ) {
      setError(
        "Please confirm that you reviewed the AI warnings before approving this listing."
      );

      return;
    }

    setSaving(true);

    setError("");
    setMessage("");

    const supabase =
      createClient();

    const {
      error: updateError,
    } = await supabase
      .from("listing_drafts")
      .update({
        generated_title:
          result.title.trim(),

        generated_description:
          result.description.trim(),

        generated_category:
          result.category.trim(),

        generated_condition:
          result.condition.trim(),

        generated_attributes:
          cleanedAttributes,

        suggested_price:
          result.price,

        status:
          "APPROVED",

        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        result.id
      );

    if (updateError) {
      console.error(
        updateError
      );

      setError(
        "ListNexus could not save the approved listing draft."
      );

      setSaving(false);

      return;
    }

    setResult({
      ...result,

      title:
        result.title.trim(),

      description:
        result.description.trim(),

      category:
        result.category.trim(),

      condition:
        result.condition.trim(),

      attributes:
        cleanedAttributes,

      status:
        "APPROVED",
    });

    clearEbayPreparation();

    setMessage(
      "Listing approved. Your seller-reviewed values are now ready for marketplace processing."
    );

    setSaving(false);
  }

  /*
   * =====================================================
   * APPLY EBAY PREPARATION
   * =====================================================
   */

  function applyEbayPreparation(
    data: EbayPreparation
  ) {
    setEbayPreparation(
      data
    );

    setSelectedEbayCategoryId(
      data.ebay.suggestedCategory
        .categoryId
    );

    const initialAspects:
      Record<string, string> =
        {};

    for (
      const aspect of
        data.ebay.requiredAspects
    ) {
      const matchingAttribute =
        data.approvedListing.attributes.find(
          (attribute) =>
            attribute.name
              .trim()
              .toLowerCase() ===
            aspect.name
              .trim()
              .toLowerCase()
        );

      if (
        matchingAttribute
      ) {
        if (
          aspect.values.length > 0
        ) {
          const matchingValue =
            aspect.values.find(
              (value) =>
                value
                  .trim()
                  .toLowerCase() ===
                matchingAttribute.value
                  .trim()
                  .toLowerCase()
            );

          initialAspects[
            aspect.name
          ] =
            matchingValue ??
            "";
        } else {
          initialAspects[
            aspect.name
          ] =
            matchingAttribute.value;
        }
      } else {
        initialAspects[
          aspect.name
        ] =
          "";
      }
    }

    setEbayAspectSelections(
      initialAspects
    );

    /*
     * Seller must explicitly select condition.
     */
    setSelectedEbayConditionId(
      ""
    );

    setEbayDescriptorSelections(
      {}
    );

    setEbayPublishedListing(
      null
    );
  }

  /*
   * =====================================================
   * PREPARE FOR EBAY
   * =====================================================
   */

  async function handlePrepareForEbay() {
    if (!result) {
      return;
    }

    if (
      result.status !==
      "APPROVED"
    ) {
      setError(
        "You must approve the listing before preparing it for eBay."
      );

      return;
    }

    setPreparingEbay(true);

    setError("");
    setMessage("");

    clearEbayPreparation();

    try {
      const response =
        await fetch(
          "/api/ebay/prepare",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              draftId:
                result.id,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "ListNexus could not prepare this listing for eBay."
        );
      }

      applyEbayPreparation(
        data as EbayPreparation
      );

      setMessage(
        "eBay preparation complete. Review the eBay category, item specifics, and condition before publishing."
      );
    } catch (
      prepareError
    ) {
      if (
        prepareError instanceof Error
      ) {
        setError(
          prepareError.message
        );
      } else {
        setError(
          "Something went wrong while preparing the listing for eBay."
        );
      }
    } finally {
      setPreparingEbay(
        false
      );
    }
  }

  /*
   * =====================================================
   * CHANGE EBAY CATEGORY
   * =====================================================
   */

  async function handleEbayCategoryChange(
    categoryId: string
  ) {
    if (!result) {
      return;
    }

    setSelectedEbayCategoryId(
      categoryId
    );

    setPreparingEbay(true);

    setError("");
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/ebay/prepare",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              draftId:
                result.id,

              categoryId,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Could not load the selected eBay category."
        );
      }

      applyEbayPreparation(
        data as EbayPreparation
      );

      setMessage(
        "eBay category updated. Review the new marketplace requirements."
      );
    } catch (
      categoryError
    ) {
      if (
        categoryError instanceof Error
      ) {
        setError(
          categoryError.message
        );
      } else {
        setError(
          "Could not update the eBay category."
        );
      }
    } finally {
      setPreparingEbay(
        false
      );
    }
  }

  /*
   * =====================================================
   * CHANGE EBAY ITEM SPECIFIC
   * =====================================================
   */

  function handleEbayAspectChange(
    aspectName: string,
    value: string
  ) {
    setEbayAspectSelections(
      (current) => ({
        ...current,

        [aspectName]:
          value,
      })
    );

    setEbayPublishedListing(
      null
    );
  }

  /*
   * =====================================================
   * CHANGE EBAY CONDITION
   * =====================================================
   */

  function handleEbayConditionChange(
    conditionId: string
  ) {
    setSelectedEbayConditionId(
      conditionId
    );

    setEbayDescriptorSelections(
      {}
    );

    setEbayPublishedListing(
      null
    );
  }

  /*
   * =====================================================
   * CHANGE EBAY CONDITION DETAIL
   * =====================================================
   */

  function handleEbayDescriptorChange(
    descriptorId: string,
    value: string
  ) {
    setEbayDescriptorSelections(
      (current) => ({
        ...current,

        [descriptorId]:
          value,
      })
    );

    setEbayPublishedListing(
      null
    );
  }

  /*
   * =====================================================
   * PUBLISH TO EBAY SANDBOX
   * =====================================================
   *
   * THIS ACTUALLY CREATES THE EBAY SANDBOX LISTING.
   */

  async function handlePublishToEbay() {
    if (!result) {
      return;
    }

    if (
      result.status !==
      "APPROVED"
    ) {
      setError(
        "The listing must be approved before publishing."
      );

      return;
    }

    if (!ebayPreparation) {
      setError(
        "Prepare the listing for eBay before publishing."
      );

      return;
    }

    if (
      !selectedEbayCategoryId
    ) {
      setError(
        "Please select an eBay category."
      );

      return;
    }

    if (
      !selectedEbayConditionId
    ) {
      setError(
        "Please select an eBay condition."
      );

      return;
    }

    if (
      !ebayPublishValidation.ready
    ) {
      setError(
        `Complete the following before publishing: ${ebayPublishValidation.missing.join(
          ", "
        )}`
      );

      return;
    }

    /*
     * Final confirmation.
     */
    const confirmed =
      window.confirm(
        "Publish this listing to eBay Sandbox?\n\n" +
          "This WILL create an active SANDBOX listing.\n\n" +
          `Title: ${result.title}\n` +
          `Price: $${Number(
            result.price
          ).toFixed(2)}\n` +
          `Quantity: ${ebayPreparation.product.quantity}\n\n` +
          "This will NOT publish to production eBay."
      );

    if (!confirmed) {
      return;
    }

    setPublishingEbay(true);

    setError("");
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/ebay/publish",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              draftId:
                result.id,

              categoryId:
                selectedEbayCategoryId,

              aspects:
                ebayAspectSelections,

              conditionId:
                selectedEbayConditionId,

              conditionDescriptors:
                ebayDescriptorSelections,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "ListNexus could not publish the listing to eBay Sandbox."
        );
      }

      const offerId =
        data.ebay?.offerId ??
        data.offerId ??
        "";

      const listingId =
        data.ebay?.listingId ??
        data.listingId ??
        "";

      const listingUrl =
        data.ebay?.listingUrl ??
        data.listingUrl ??
        "";

      setEbayPublishedListing({
        offerId,
        listingId,
        listingUrl,
      });

      if (data.warning) {
        setMessage(
          `eBay Sandbox listing published, but ListNexus reported a warning: ${data.warning}`
        );
      } else {
        setMessage(
          "Listing published successfully to eBay Sandbox!"
        );
      }
    } catch (
      publishError
    ) {
      if (
        publishError instanceof Error
      ) {
        setError(
          publishError.message
        );
      } else {
        setError(
          "Something went wrong while publishing to eBay Sandbox."
        );
      }
    } finally {
      setPublishingEbay(
        false
      );
    }
  }

  /*
   * =====================================================
   * RENDER
   * =====================================================
   */

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* NAVIGATION */}

      <nav className="flex items-center justify-between bg-white px-10 py-6 shadow-sm">
        <a
          href="/"
          className="text-2xl font-bold text-blue-600"
        >
          ListNexus
        </a>

        <div className="flex gap-6 text-sm font-medium">
          <a
            href="/"
            className="hover:text-blue-600"
          >
            Home
          </a>

          <a
            href="/dashboard"
            className="hover:text-blue-600"
          >
            Dashboard
          </a>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-6 py-12">
        {/* HEADER */}

        <div className="mb-10 text-center">
          <p className="mb-2 font-semibold text-blue-600">
            AI-Assisted Listing
          </p>

          <h1 className="mb-4 text-4xl font-bold">
            Generate a Product Listing
          </h1>

          <p className="mx-auto max-w-2xl text-gray-600">
            Select a product already stored in
            ListNexus. AI will analyze the
            centralized product information and
            stored images to generate a listing
            draft. You have final control before
            anything is published.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          {/* =================================================
              LEFT SIDE
              ================================================= */}

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="mb-6 text-2xl font-semibold">
              ListNexus Product
            </h2>

            {loadingProducts && (
              <p className="text-gray-500">
                Loading your products...
              </p>
            )}

            {!loadingProducts &&
              products.length ===
                0 && (
                <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-yellow-900">
                  No products were found in your
                  ListNexus inventory.
                </div>
              )}

            {!loadingProducts &&
              products.length >
                0 && (
                <>
                  {/* PRODUCT SELECTOR */}

                  <div className="mb-6">
                    <label className="mb-2 block font-medium">
                      Select Product
                    </label>

                    <select
                      value={
                        selectedProductId
                      }
                      onChange={(
                        event
                      ) =>
                        handleProductChange(
                          event.target
                            .value
                        )
                      }
                      className="w-full rounded-lg border px-4 py-3"
                    >
                      {products.map(
                        (product) => (
                          <option
                            key={
                              product.id
                            }
                            value={
                              product.id
                            }
                          >
                            {
                              product.title
                            }{" "}
                            —{" "}
                            {
                              product.sku
                            }
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  {selectedProduct && (
                    <>
                      {/* CENTRAL PRODUCT DATA */}

                      <div className="mb-6 rounded-lg bg-gray-50 p-4">
                        <h3 className="mb-3 text-lg font-semibold">
                          Central Product Data
                        </h3>

                        <div className="space-y-2 text-sm">
                          <p>
                            <span className="font-semibold">
                              Title:
                            </span>{" "}
                            {
                              selectedProduct.title
                            }
                          </p>

                          <p>
                            <span className="font-semibold">
                              SKU:
                            </span>{" "}
                            {
                              selectedProduct.sku
                            }
                          </p>

                          <p>
                            <span className="font-semibold">
                              Base Price:
                            </span>{" "}
                            $
                            {Number(
                              selectedProduct.price
                            ).toFixed(
                              2
                            )}
                          </p>

                          {/* QUANTITY */}

                          <div className="mt-4">
                            <label className="mb-2 block font-semibold">
                              Available Quantity
                            </label>

                            <div className="flex gap-2">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={
                                  quantityInput
                                }
                                onChange={(
                                  event
                                ) =>
                                  setQuantityInput(
                                    event
                                      .target
                                      .value
                                  )
                                }
                                className="w-28 rounded-lg border px-3 py-2"
                              />

                              <button
                                type="button"
                                onClick={
                                  handleSaveQuantity
                                }
                                disabled={
                                  savingQuantity
                                }
                                className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800 disabled:bg-gray-400"
                              >
                                {savingQuantity
                                  ? "Saving..."
                                  : "Save Quantity"}
                              </button>
                            </div>

                            <p className="mt-2 text-xs text-gray-500">
                              This is the centralized
                              inventory quantity used
                              by all marketplaces.
                            </p>
                          </div>

                          <p>
                            <span className="font-semibold">
                              Status:
                            </span>{" "}
                            {
                              selectedProduct.status
                            }
                          </p>

                          <p>
                            <span className="font-semibold">
                              Category:
                            </span>{" "}
                            {selectedProduct.category ||
                              "Not provided"}
                          </p>
                        </div>

                        {selectedProduct.description && (
                          <div className="mt-4">
                            <p className="font-semibold">
                              Seller Notes
                            </p>

                            <p className="mt-1 text-sm text-gray-600">
                              {
                                selectedProduct.description
                              }
                            </p>
                          </div>
                        )}
                      </div>

                      {/* IMAGES */}

                      <div className="mb-6">
                        <h3 className="mb-3 font-semibold">
                          Stored Product Images
                        </h3>

                        {selectedImages.length >
                        0 ? (
                          <div className="grid grid-cols-2 gap-4">
                            {selectedImages.map(
                              (
                                image,
                                index
                              ) => (
                                <div
                                  key={
                                    image.id
                                  }
                                  className="overflow-hidden rounded-lg border bg-gray-50"
                                >
                                  <img
                                    src={
                                      image.image_url
                                    }
                                    alt={`Product image ${
                                      index +
                                      1
                                    }`}
                                    className="h-48 w-full object-contain"
                                  />

                                  <div className="p-2 text-center text-xs text-gray-500">
                                    {image.is_primary
                                      ? "Primary image"
                                      : `Image ${
                                          index +
                                          1
                                        }`}
                                  </div>

                                  <a
                                    href={
                                      image.image_url
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block pb-3 text-center text-xs text-blue-600 hover:underline"
                                  >
                                    Open original
                                  </a>
                                </div>
                              )
                            )}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
                            This product has no stored
                            images yet.
                          </div>
                        )}
                      </div>

                      {/* GENERATE */}

                      <button
                        type="button"
                        onClick={
                          handleGenerate
                        }
                        disabled={
                          generating ||
                          selectedImages.length ===
                            0 ||
                          selectedProduct.status !==
                            "AVAILABLE"
                        }
                        className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:bg-gray-400"
                      >
                        {generating
                          ? "AI is analyzing product..."
                          : "Generate AI Listing"}
                      </button>

                      {selectedProduct.status !==
                        "AVAILABLE" && (
                        <p className="mt-3 text-sm text-yellow-700">
                          This product must be
                          AVAILABLE before generating
                          a marketplace listing.
                        </p>
                      )}
                    </>
                  )}

                  {/* ERROR */}

                  {error && (
                    <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                      {error}
                    </p>
                  )}

                  {/* MESSAGE */}

                  {message && (
                    <p className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-green-700">
                      {message}
                    </p>
                  )}
                </>
              )}
          </div>

          {/* =================================================
              RIGHT SIDE
              ================================================= */}

          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="mb-6 text-2xl font-semibold">
              AI Listing Draft
            </h2>

            {!result &&
              !generating && (
                <p className="text-gray-500">
                  Select a ListNexus product and click
                  Generate AI Listing. A saved draft
                  will automatically reappear here.
                </p>
              )}

            {generating && (
              <div className="rounded-lg bg-blue-50 p-4 text-blue-800">
                AI is analyzing the centralized
                product information and stored
                images...
              </div>
            )}

            {result && (
              <div className="space-y-6">
                {/* STATUS */}

                <div>
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                      result.status ===
                      "APPROVED"
                        ? "bg-green-100 text-green-800"
                        : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {
                      result.status
                    }
                  </span>
                </div>

                {/* TITLE */}

                <div>
                  <label className="mb-2 block font-semibold text-gray-700">
                    Listing Title
                  </label>

                  <input
                    type="text"
                    value={
                      result.title
                    }
                    onChange={(
                      event
                    ) =>
                      updateResultField(
                        "title",
                        event.target
                          .value
                      )
                    }
                    className="w-full rounded-lg border px-4 py-2"
                  />
                </div>

                {/* DESCRIPTION */}

                <div>
                  <label className="mb-2 block font-semibold text-gray-700">
                    Listing Description
                  </label>

                  <textarea
                    value={
                      result.description
                    }
                    onChange={(
                      event
                    ) =>
                      updateResultField(
                        "description",
                        event.target
                          .value
                      )
                    }
                    className="w-full rounded-lg border px-4 py-2"
                    rows={7}
                  />
                </div>

                {/* CATEGORY */}

                <div>
                  <label className="mb-2 block font-semibold text-gray-700">
                    Category
                  </label>

                  <input
                    type="text"
                    value={
                      result.category
                    }
                    onChange={(
                      event
                    ) =>
                      updateResultField(
                        "category",
                        event.target
                          .value
                      )
                    }
                    className="w-full rounded-lg border px-4 py-2"
                  />
                </div>

                {/* CONDITION */}

                <div>
                  <label className="mb-2 block font-semibold text-gray-700">
                    Condition
                  </label>

                  <input
                    type="text"
                    value={
                      result.condition
                    }
                    onChange={(
                      event
                    ) =>
                      updateResultField(
                        "condition",
                        event.target
                          .value
                      )
                    }
                    className="w-full rounded-lg border px-4 py-2"
                  />
                </div>

                {/* PRICE */}

                <div>
                  <label className="mb-2 block font-semibold text-gray-700">
                    Listing Price
                  </label>

                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
                      $
                    </span>

                    <input
                      type="number"
                      value={
                        result.price
                      }
                      onChange={(
                        event
                      ) =>
                        updateResultField(
                          "price",
                          Number(
                            event
                              .target
                              .value
                          )
                        )
                      }
                      min="0"
                      step="0.01"
                      className="w-full rounded-lg border py-2 pl-8 pr-4"
                    />
                  </div>

                  {selectedProduct && (
                    <p className="mt-1 text-xs text-gray-400">
                      Central product base price: $
                      {Number(
                        selectedProduct.price
                      ).toFixed(
                        2
                      )}
                    </p>
                  )}
                </div>

                {/* ATTRIBUTES */}

                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-700">
                      Product Attributes
                    </h3>

                    <button
                      type="button"
                      onClick={
                        addAttribute
                      }
                      className="text-sm font-semibold text-blue-600 hover:underline"
                    >
                      + Add Attribute
                    </button>
                  </div>

                  {result.attributes.length >
                  0 ? (
                    <div className="space-y-3">
                      {result.attributes.map(
                        (
                          attribute,
                          index
                        ) => (
                          <div
                            key={
                              index
                            }
                            className="grid grid-cols-[1fr_1fr_auto] gap-2"
                          >
                            <input
                              type="text"
                              value={
                                attribute.name
                              }
                              onChange={(
                                event
                              ) =>
                                updateAttribute(
                                  index,
                                  "name",
                                  event
                                    .target
                                    .value
                                )
                              }
                              placeholder="Attribute"
                              className="rounded-lg border px-3 py-2"
                            />

                            <input
                              type="text"
                              value={
                                attribute.value
                              }
                              onChange={(
                                event
                              ) =>
                                updateAttribute(
                                  index,
                                  "value",
                                  event
                                    .target
                                    .value
                                )
                              }
                              placeholder="Value"
                              className="rounded-lg border px-3 py-2"
                            />

                            <button
                              type="button"
                              onClick={() =>
                                removeAttribute(
                                  index
                                )
                              }
                              className="rounded-lg border px-3 py-2 text-red-600 hover:bg-red-50"
                            >
                              X
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">
                      AI did not generate any
                      attributes.
                    </p>
                  )}
                </div>

                {/* CONFIRMATION */}

                <div>
                  <h3 className="mb-2 font-semibold text-gray-700">
                    Needs Confirmation
                  </h3>

                  {result.needsConfirmation.length >
                  0 ? (
                    <>
                      <div className="space-y-2">
                        {result.needsConfirmation.map(
                          (
                            item,
                            index
                          ) => (
                            <div
                              key={
                                index
                              }
                              className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900"
                            >
                              <span className="font-semibold">
                                Please verify:
                              </span>{" "}
                              {
                                item
                              }
                            </div>
                          )
                        )}
                      </div>

                      <label className="mt-4 flex items-start gap-3 rounded-lg border p-3">
                        <input
                          type="checkbox"
                          checked={
                            confirmationReviewed
                          }
                          onChange={(
                            event
                          ) =>
                            setConfirmationReviewed(
                              event
                                .target
                                .checked
                            )
                          }
                          className="mt-1"
                        />

                        <span className="text-sm">
                          I reviewed the items above
                          and understand that they
                          require seller confirmation.
                        </span>
                      </label>
                    </>
                  ) : (
                    <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800">
                      No additional information needs
                      confirmation.
                    </div>
                  )}
                </div>

                {/* SELLER CONTROL */}

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <h3 className="font-semibold text-gray-800">
                    Seller Review Required
                  </h3>

                  <p className="mt-2 text-sm text-gray-600">
                    AI output is only a suggestion.
                    You have final control over the
                    title, description, category,
                    condition, price, and attributes.
                  </p>
                </div>

                {/* APPROVE */}

                {result.status !==
                  "APPROVED" && (
                  <button
                    type="button"
                    onClick={
                      handleApproveDraft
                    }
                    disabled={
                      saving
                    }
                    className="w-full rounded-lg bg-green-600 px-6 py-3 font-semibold text-white hover:bg-green-700 disabled:bg-gray-400"
                  >
                    {saving
                      ? "Saving..."
                      : "Approve Listing Draft"}
                  </button>
                )}

                {/* =================================================
                    APPROVED LISTING
                    ================================================= */}

                {result.status ===
                  "APPROVED" && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <h3 className="font-semibold text-blue-900">
                        Ready for Marketplaces
                      </h3>

                      <p className="mt-2 text-sm text-blue-800">
                        The seller-reviewed listing
                        is approved and can now be
                        prepared for eBay.
                      </p>

                      <div className="mt-4">
                        <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-blue-700">
                          eBay Sandbox connected
                        </span>
                      </div>
                    </div>

                    {/* PREPARE */}

                    <button
                      type="button"
                      onClick={
                        handlePrepareForEbay
                      }
                      disabled={
                        preparingEbay ||
                        publishingEbay
                      }
                      className="w-full rounded-lg bg-gray-900 px-6 py-3 font-semibold text-white hover:bg-gray-800 disabled:bg-gray-400"
                    >
                      {preparingEbay
                        ? "Checking eBay Requirements..."
                        : "Prepare for eBay Sandbox"}
                    </button>

                    <p className="text-center text-xs text-gray-500">
                      Preparing does not publish the
                      listing.
                    </p>

                    {/* =================================================
                        EBAY PREVIEW
                        ================================================= */}

                    {ebayPreparation && (
                      <div className="space-y-6 rounded-lg border border-gray-200 bg-gray-50 p-5">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            eBay Sandbox Preview
                          </h3>

                          <p className="mt-1 text-sm text-gray-600">
                            Review all eBay-specific
                            settings before
                            publishing.
                          </p>
                        </div>

                        {/* CATEGORY */}

                        <div>
                          <label className="mb-2 block font-semibold text-gray-800">
                            eBay Category
                          </label>

                          <select
                            value={
                              selectedEbayCategoryId
                            }
                            onChange={(
                              event
                            ) =>
                              handleEbayCategoryChange(
                                event
                                  .target
                                  .value
                              )
                            }
                            disabled={
                              preparingEbay ||
                              publishingEbay
                            }
                            className="w-full rounded-lg border bg-white px-4 py-3"
                          >
                            {ebayPreparation.ebay.categoryAlternatives.map(
                              (
                                category
                              ) => (
                                <option
                                  key={
                                    category.categoryId
                                  }
                                  value={
                                    category.categoryId
                                  }
                                >
                                  {
                                    category.categoryName
                                  }{" "}
                                  (
                                  {
                                    category.categoryId
                                  }
                                  )
                                </option>
                              )
                            )}
                          </select>

                          <p className="mt-2 text-xs text-gray-500">
                            eBay suggested this
                            category, but the seller
                            has final control.
                          </p>
                        </div>

                        {/* QUANTITY */}

                        <div>
                          <h4 className="font-semibold text-gray-800">
                            Quantity to Send
                          </h4>

                          <p className="mt-1 text-lg">
                            {
                              ebayPreparation.product.quantity
                            }
                          </p>

                          <p className="text-xs text-gray-500">
                            This comes directly from
                            centralized
                            products.quantity.
                          </p>
                        </div>

                        {/* PRICE */}

                        <div>
                          <h4 className="font-semibold text-gray-800">
                            Approved Listing Price
                          </h4>

                          <p className="mt-1 text-lg">
                            $
                            {Number(
                              ebayPreparation.approvedListing.price
                            ).toFixed(
                              2
                            )}
                          </p>
                        </div>

                        {/* ITEM SPECIFICS */}

                        <div>
                          <h4 className="mb-3 font-semibold text-gray-800">
                            Required eBay Item
                            Specifics
                          </h4>

                          {ebayPreparation.ebay.requiredAspects.length >
                          0 ? (
                            <div className="space-y-4">
                              {ebayPreparation.ebay.requiredAspects.map(
                                (
                                  aspect
                                ) => (
                                  <div
                                    key={
                                      aspect.name
                                    }
                                    className="rounded-lg border bg-white p-4"
                                  >
                                    <label className="mb-2 block font-semibold">
                                      {
                                        aspect.name
                                      }

                                      <span className="ml-1 text-red-600">
                                        *
                                      </span>
                                    </label>

                                    {aspect.values.length >
                                    0 ? (
                                      <select
                                        value={
                                          ebayAspectSelections[
                                            aspect.name
                                          ] ??
                                          ""
                                        }
                                        onChange={(
                                          event
                                        ) =>
                                          handleEbayAspectChange(
                                            aspect.name,
                                            event
                                              .target
                                              .value
                                          )
                                        }
                                        disabled={
                                          publishingEbay
                                        }
                                        className="w-full rounded-lg border px-3 py-2"
                                      >
                                        <option value="">
                                          Select{" "}
                                          {
                                            aspect.name
                                          }
                                          ...
                                        </option>

                                        {aspect.values.map(
                                          (
                                            value
                                          ) => (
                                            <option
                                              key={
                                                value
                                              }
                                              value={
                                                value
                                              }
                                            >
                                              {
                                                value
                                              }
                                            </option>
                                          )
                                        )}
                                      </select>
                                    ) : (
                                      <input
                                        type="text"
                                        value={
                                          ebayAspectSelections[
                                            aspect.name
                                          ] ??
                                          ""
                                        }
                                        onChange={(
                                          event
                                        ) =>
                                          handleEbayAspectChange(
                                            aspect.name,
                                            event
                                              .target
                                              .value
                                          )
                                        }
                                        disabled={
                                          publishingEbay
                                        }
                                        className="w-full rounded-lg border px-3 py-2"
                                        placeholder={`Enter ${aspect.name}`}
                                      />
                                    )}
                                  </div>
                                )
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500">
                              eBay did not report any
                              required item specifics
                              for this category.
                            </p>
                          )}
                        </div>

                        {/* CONDITION */}

                        <div>
                          <label className="mb-2 block font-semibold text-gray-800">
                            eBay Condition
                          </label>

                          <select
                            value={
                              selectedEbayConditionId
                            }
                            onChange={(
                              event
                            ) =>
                              handleEbayConditionChange(
                                event
                                  .target
                                  .value
                              )
                            }
                            disabled={
                              publishingEbay
                            }
                            className="w-full rounded-lg border bg-white px-4 py-3"
                          >
                            <option value="">
                              Select condition...
                            </option>

                            {ebayPreparation.ebay.conditionOptions.map(
                              (
                                condition
                              ) => (
                                <option
                                  key={
                                    condition.conditionId
                                  }
                                  value={
                                    condition.conditionId
                                  }
                                >
                                  {
                                    condition.conditionDescription
                                  }
                                </option>
                              )
                            )}
                          </select>

                          {selectedEbayCondition?.conditionHelpText && (
                            <p className="mt-2 text-xs text-gray-500">
                              {
                                selectedEbayCondition.conditionHelpText
                              }
                            </p>
                          )}
                        </div>

                        {/* CONDITION DETAILS */}

                        {selectedEbayCondition &&
                          selectedEbayCondition.descriptors.length >
                            0 && (
                            <div>
                              <h4 className="mb-3 font-semibold text-gray-800">
                                Condition Details
                              </h4>

                              <div className="space-y-4">
                                {selectedEbayCondition.descriptors.map(
                                  (
                                    descriptor
                                  ) => {
                                    const freeTextMode =
                                      Array.isArray(
                                        descriptor.mode
                                      )
                                        ? descriptor.mode.includes(
                                            "FREE_TEXT"
                                          )
                                        : descriptor.mode ===
                                          "FREE_TEXT";

                                    return (
                                      <div
                                        key={
                                          descriptor.descriptorId
                                        }
                                        className="rounded-lg border bg-white p-4"
                                      >
                                        <label className="mb-2 block font-semibold">
                                          {
                                            descriptor.name
                                          }

                                          {descriptor.required && (
                                            <span className="ml-1 text-red-600">
                                              *
                                            </span>
                                          )}
                                        </label>

                                        {descriptor.values.length >
                                        0 ? (
                                          <select
                                            value={
                                              ebayDescriptorSelections[
                                                descriptor
                                                  .descriptorId
                                              ] ??
                                              ""
                                            }
                                            onChange={(
                                              event
                                            ) =>
                                              handleEbayDescriptorChange(
                                                descriptor.descriptorId,
                                                event
                                                  .target
                                                  .value
                                              )
                                            }
                                            disabled={
                                              publishingEbay
                                            }
                                            className="w-full rounded-lg border px-3 py-2"
                                          >
                                            <option value="">
                                              Select{" "}
                                              {
                                                descriptor.name
                                              }
                                              ...
                                            </option>

                                            {descriptor.values.map(
                                              (
                                                value
                                              ) => (
                                                <option
                                                  key={
                                                    value.valueId
                                                  }
                                                  value={
                                                    value.valueId
                                                  }
                                                >
                                                  {
                                                    value.valueName
                                                  }
                                                </option>
                                              )
                                            )}
                                          </select>
                                        ) : freeTextMode ? (
                                          <input
                                            type="text"
                                            value={
                                              ebayDescriptorSelections[
                                                descriptor
                                                  .descriptorId
                                              ] ??
                                              ""
                                            }
                                            onChange={(
                                              event
                                            ) =>
                                              handleEbayDescriptorChange(
                                                descriptor.descriptorId,
                                                event
                                                  .target
                                                  .value
                                              )
                                            }
                                            disabled={
                                              publishingEbay
                                            }
                                            className="w-full rounded-lg border px-3 py-2"
                                            placeholder={`Enter ${descriptor.name}`}
                                          />
                                        ) : (
                                          <p className="text-sm text-gray-500">
                                            eBay did
                                            not return
                                            selectable
                                            values for
                                            this
                                            descriptor.
                                          </p>
                                        )}
                                      </div>
                                    );
                                  }
                                )}
                              </div>
                            </div>
                          )}

                        {/* CONDITION SUMMARY */}

                        {selectedEbayCondition && (
                          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                            <p>
                              <span className="font-semibold">
                                Selected condition:
                              </span>{" "}
                              {
                                selectedEbayCondition.conditionDescription
                              }
                            </p>

                            <p className="mt-1">
                              <span className="font-semibold">
                                eBay Condition ID:
                              </span>{" "}
                              {
                                selectedEbayCondition.conditionId
                              }
                            </p>
                          </div>
                        )}

                        {/* =================================================
                            PUBLISH
                            ================================================= */}

                        {!ebayPublishedListing ? (
                          <div className="space-y-4">
                            {!ebayPublishValidation.ready &&
                              ebayPublishValidation.missing.length >
                                0 && (
                                <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
                                  <p className="font-semibold">
                                    Complete these
                                    fields before
                                    publishing:
                                  </p>

                                  <ul className="mt-2 list-disc space-y-1 pl-5">
                                    {ebayPublishValidation.missing.map(
                                      (
                                        item
                                      ) => (
                                        <li
                                          key={
                                            item
                                          }
                                        >
                                          {
                                            item
                                          }
                                        </li>
                                      )
                                    )}
                                  </ul>
                                </div>
                              )}

                            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                              <h4 className="font-semibold text-red-900">
                                Ready to Publish
                              </h4>

                              <p className="mt-2 text-sm text-red-800">
                                The button below will
                                create an active
                                listing in eBay
                                Sandbox. It will not
                                publish anything to
                                production eBay.
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={
                                handlePublishToEbay
                              }
                              disabled={
                                publishingEbay ||
                                preparingEbay ||
                                !ebayPublishValidation.ready
                              }
                              className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:bg-gray-400"
                            >
                              {publishingEbay
                                ? "Publishing to eBay Sandbox..."
                                : "Publish to eBay Sandbox"}
                            </button>
                          </div>
                        ) : (
                          /* PUBLISHED SUCCESS */

                          <div className="rounded-lg border border-green-300 bg-green-50 p-5">
                            <h3 className="text-lg font-semibold text-green-900">
                              Published to eBay
                              Sandbox
                            </h3>

                            <div className="mt-3 space-y-2 text-sm text-green-900">
                              <p>
                                <span className="font-semibold">
                                  Listing ID:
                                </span>{" "}
                                {
                                  ebayPublishedListing.listingId
                                }
                              </p>

                              <p>
                                <span className="font-semibold">
                                  Offer ID:
                                </span>{" "}
                                {
                                  ebayPublishedListing.offerId
                                }
                              </p>
                            </div>

                            {ebayPublishedListing.listingUrl && (
                              <a
                                href={
                                  ebayPublishedListing.listingUrl
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="mt-4 inline-block rounded-lg bg-green-700 px-5 py-2 font-semibold text-white hover:bg-green-800"
                              >
                                View eBay Sandbox
                                Listing
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}