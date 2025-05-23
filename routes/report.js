const express = require("express");
const axios = require("axios");
const router = express.Router();

router.get("/search", async (req, res) => {
  try {
    const [ordersRes, productsRes] = await Promise.all([
      axios.get("https://apirecycle.unii.co.th/Stock/query-transaction-demo"),
      axios.get("https://apirecycle.unii.co.th/category/query-product-demo"),
    ]);

    const { buyTransaction = [], sellTransaction = [] } = ordersRes.data || {};
    const products = Object.values(productsRes?.data?.productList || {});
    const productMap = new Map(products.map((p) => [p.categoryId, p]));

    const {
      startDate,
      endDate,
      categoryId,
      subCategoryId,
      orderId,
      minPrice,
      maxPrice,
      grade,
      keyword,
    } = req.query;

    const normalizeCategoryId = (id) => id.toString().padStart(2, "0");
    const normalizeSubCategoryId = (id) => id.toString().padStart(4, "0");

    const normCategoryId = categoryId ? normalizeCategoryId(categoryId) : null;
    const normSubCategoryId = subCategoryId
      ? normalizeSubCategoryId(subCategoryId)
      : null;

    let transactions = [...buyTransaction, ...sellTransaction];

   
    if (startDate) {
      const start = new Date(startDate);
      transactions = transactions.filter(
        (t) => new Date(t.orderFinishedDate) >= start
      );
    }
    if (endDate) {
      const end = new Date(endDate);
      transactions = transactions.filter(
        (t) => new Date(t.orderFinishedDate) <= end
      );
    }
    if (orderId) {
      transactions = transactions.filter((t) => t.orderId === orderId);
    }

   
    if (normCategoryId) {
      transactions = transactions
        .map((t) => ({
          ...t,
          requestList: (t.requestList || []).filter(
            (r) => r.categoryID === normCategoryId
          ),
        }))
        .filter((t) => t.requestList.length > 0);
    }

   
    if (normSubCategoryId || grade || minPrice || maxPrice) {
      transactions = transactions
        .map((t) => {
          const filteredGroups = (t.requestList || [])
            .map((group) => ({
              ...group,
              requestList: (group.requestList || []).filter((r) => {
                if (
                  normSubCategoryId &&
                  group.subCategoryID !== normSubCategoryId
                )
                  return false;
                if (grade && r.grade !== grade) return false;
                if (minPrice && r.total < parseFloat(minPrice)) return false;
                if (maxPrice && r.total > parseFloat(maxPrice)) return false;
                return true;
              }),
            }))
            .filter((g) => g.requestList.length > 0);

          return { ...t, requestList: filteredGroups };
        })
        .filter((t) => t.requestList.length > 0);
    }

   
    if (keyword?.trim()) {
      const lowerKeyword = keyword.toLowerCase();

      transactions = transactions
        .map((t) => {
          const matchesOrderId = t.orderId
            ?.toLowerCase()
            .includes(lowerKeyword);

          const filteredGroups = (t.requestList || [])
            .map((group) => {
              const sub = productMap
                .get(group.categoryID)
                ?.subcategory?.find(
                  (s) => s.subCategoryId === group.subCategoryID
                );
              const name = sub?.subCategoryName?.toLowerCase() || "";

              return name.includes(lowerKeyword) ? group : null;
            })
            .filter(Boolean);

          if (matchesOrderId && filteredGroups.length === 0) {
            return t;
          }

          return { ...t, requestList: filteredGroups };
        })
        .filter(
          (t) =>
            t.requestList.length > 0 ||
            t.orderId?.toLowerCase().includes(lowerKeyword)
        );
    }

   
    const summaryMap = new Map();
    const buyOrderIds = new Set(buyTransaction.map((t) => t.orderId));

    transactions.forEach((t) => {
      const isBuy = buyOrderIds.has(t.orderId);

      t.requestList.forEach((group) => {
        const key = `${group.categoryID}-${group.subCategoryID}`;

        if (!summaryMap.has(key)) {
          summaryMap.set(key, {
            categoryId: group.categoryID,
            subCategoryId: group.subCategoryID,
            buyWeight: 0,
            sellWeight: 0,
            buyTotal: 0,
            sellTotal: 0,
            buyCount: 0,
            sellCount: 0,
          });
        }

        const record = summaryMap.get(key);

        group.requestList.forEach((r) => {
          const quantity = parseFloat(r.quantity || 0);
          const total = parseFloat(r.total || 0);

          if (isBuy) {
            record.buyWeight += quantity;
            record.buyTotal += total;
            if (total > 0) record.buyCount++;
          } else {
            record.sellWeight += quantity;
            record.sellTotal += total;
            if (total > 0) record.sellCount++;
          }
        });
      });
    });

    const data = Array.from(summaryMap.values()).map((rec) => {
      const cat = productMap.get(rec.categoryId);
      const sub = cat?.subcategory?.find(
        (s) => s.subCategoryId === rec.subCategoryId
      );

      return {
        categoryId: rec.categoryId,
        subCategoryId: rec.subCategoryId,
        categoryName: cat?.categoryName || `Category ${rec.categoryId}`,
        subCategoryName:
          sub?.subCategoryName || `SubCategory ${rec.subCategoryId}`,
        buyWeight: rec.buyWeight,
        buyTotal: rec.buyTotal,
        sellWeight: rec.sellWeight,
        sellTotal: rec.sellTotal,
        remainWeight: rec.sellWeight - rec.buyWeight,
        remainAmount: rec.sellTotal - rec.buyTotal,
        remainCount: rec.sellCount - rec.buyCount,
        buyCount: rec.buyCount,
        sellCount: rec.sellCount,
      };
    });

    const summary = data.reduce(
      (acc, curr) => {
        acc.totalBuyWeight += curr.buyWeight;
        acc.totalBuyTotal += curr.buyTotal;
        acc.totalSellWeight += curr.sellWeight;
        acc.totalSellTotal += curr.sellTotal;
        acc.totalRemainWeight += curr.remainWeight;
        acc.totalRemainAmount += curr.remainAmount;
        acc.totalBuyCount += curr.buyCount;
        acc.totalSellCount += curr.sellCount;
        acc.totalRemainCount += curr.remainCount;
        return acc;
      },
      {
        totalBuyWeight: 0,
        totalBuyTotal: 0,
        totalSellWeight: 0,
        totalSellTotal: 0,
        totalRemainWeight: 0,
        totalRemainAmount: 0,
        totalBuyCount: 0,
        totalSellCount: 0,
        totalRemainCount: 0,
      }
    );

    return res.json({ summary, data });
  } catch (err) {
    console.error("Search route error:", err);
    res.status(500).json({ message: "Error fetching or processing data" });
  }
});


router.get("/categories", async (req, res) => {
  try {
    const response = await axios.get(
      "https://apirecycle.unii.co.th/category/query-product-demo"
    );

    const categories = response.data.productList.map((item) => ({
      categoryId: item.categoryId,
      categoryName: item.categoryName,
    }));
    res.json({ data: categories });
  } catch (error) {
    console.error("Error fetching categories:", error.message);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

router.get("/subcategories/:categoryId", async (req, res) => {
  const { categoryId } = req.params;
  try {
    const response = await axios.get(
      "https://apirecycle.unii.co.th/category/query-product-demo"
    );

    const selectedCategory = response.data.productList.find(
      (item) => item.categoryId === categoryId
    );
    const subcategories = selectedCategory ? selectedCategory.subcategory : [];
    const formattedSubcategories = subcategories.map((item) => ({
      subCategoryId: item.subCategoryId,
      subCategoryName: item.subCategoryName,
    }));

    res.json({ data: formattedSubcategories });
  } catch (error) {
    console.error("Error fetching subcategories:", error.message);
    res.status(500).json({ error: "Failed to fetch subcategories" });
  }
});
module.exports = router;
