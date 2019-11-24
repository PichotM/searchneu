/* eslint-disable no-underscore-dangle */
/*
 * This file is part of Search NEU and licensed under AGPL3.
 * See the license file in the root folder for details.
 */

import { Client } from '@elastic/elasticsearch';
import _ from 'lodash';
import macros from './macros';

const URL = macros.getEnvVariable('elasticURL') || 'http://localhost:9200';
const client = new Client({ node: URL });

class Elastic {
  constructor() {
    // Because we export an instance of this class, put the constants on the instance.
    this.CLASS_INDEX = 'classes';
    this.EMPLOYEE_INDEX = 'employees';
    // keep internal track of the available subjects
    this.subjects = null;
  }

  async isConnected() {
    try {
      await client.ping();
    } catch (err) {
      return false;
    }
    return true;
  }

  /**
   * @param  {string} indexName The index to insert into
   * @param  {Object} mapping   The new elasticsearch index mapping(schema)
   */
  async resetIndex(indexName, mapping) {
    // Clear out the index.
    await client.indices.delete({ index: indexName }).catch(() => {});
    // Put in the new classes mapping (elasticsearch doesn't let you change mapping of existing index)
    await client.indices.create({
      index: indexName,
      body: mapping,
    });
  }

  /**
   * Bulk index a collection of documents using ids from hashmap
   * @param  {string} indexName The index to insert into
   * @param  {Object} map       A map of document ids to document sources to create
   */
  async bulkIndexFromMap(indexName, map) {
    let promises = Promise.resolve();
    for (const part of _.chunk(Object.keys(map), 100)) {
      const bulk = [];
      for (const id of part) {
        bulk.push({ index: { _id: id } });
        bulk.push(map[id]);
      }
      promises = promises.then(() => { return client.bulk({ index: indexName, refresh: 'wait_for', body: bulk }); });
    }
    return promises;
  }

  /**
   * Bulk update a collection of documents using ids from hashmap
   * @param  {string} indexName The index to update into
   * @param  {Object} map       A map of document ids to document sources to update
   */
  async bulkUpdateFromMap(indexName, map) {
    const bulk = [];
    for (const id of Object.keys(map)) {
      bulk.push({ update: { _id: id } });
      bulk.push({ doc: map[id] });
    }
    await client.bulk({ index: indexName, body: bulk });
  }

  /**
   * Get document by id
   * @param  {string} indexName Index to get from
   * @param  {string} id        ID to get
   * @return {Object} document source
   */
  async get(indexName, id) {
    return (await client.get({ index: indexName, type: '_doc', id: id })).body._source;
  }

  /**
   * Get a hashmap of ids to documents from a list of ids
   * @param  {string} indexName Index to get from
   * @param  {Array}  ids       Array of string ids to get
   * @return {Object} The map between doc ids and doc source
   */
  async getMapFromIDs(indexName, ids) {
    const got = await client.mget({
      index: indexName,
      type: '_doc',
      body: {
        ids: ids,
      },
    });
    return got.body.docs.reduce((result, doc) => {
      if (doc.found) {
        result[doc._id] = doc._source;
      }
      return result;
    }, {});
  }

  /**
   * Get all occurrences of a class
   * @param {string} host     Host to search in
   * @param {string} subject  Subject (department) to search in
   * @param {integer} classId Class ID code to find
   */
  async getAllClassOccurrences(host, subject, classId) {
    const got = await client.search({
      index: this.CLASS_INDEX,
      body: {
        size: 10,
        query: {
          bool: {
            filter: [
              { term: { 'class.host.keyword': host } },
              { term: { 'class.subject.keyword': subject } },
              { term: { 'class.classId.keyword': classId } },
            ],
          },
        },
      },
    });
    const hits = got.body.hits.hits.map((c) => { return c._source.class; });
    return hits;
  }

  /**
   * Get the latest occurrence of a class
   * @param {string} host     Host to search in
   * @param {string} subject  Subject (department) to search in
   * @param {integer} classId Class ID code to find
   */
  async getLatestClassOccurrence(host, subject, classId) {
    const got = await client.search({
      index: this.CLASS_INDEX,
      body: {
        sort: { 'class.termId.keyword' : 'desc' },
        size: 1,
        query: {
          bool: {
            filter: [
              { term: { 'class.host.keyword': host } },
              { term: { 'class.subject.keyword': subject } },
              { term: { 'class.classId.keyword': classId } },
            ],
          },
        },
      },
    });
    const hit = got.body.hits.hits[0];
    return hit ? hit._source.class : null;
  }

  /*
   * Get all subjects for classes in the index
   */
  async getSubjectsFromClasses() {
    if (this.subjects) {
      return this.subjects;
    }

    const subjectAgg = await client.search({
      index: `${this.CLASS_INDEX}`,
      body: {
        aggs: {
          subjects: {
            global: {},
            aggs: {
              subjects: {
                terms: {
                  field: 'class.subject.keyword',
                  size: 10000, // anything that will get everything
                },
              },
            },
          },
        },
      },
    });
    this.subjects = new Set(_.map(subjectAgg.body.aggregations.subjects.subjects.buckets, (subject) => { return subject.key.toLowerCase(); }));

    return this.subjects;
  }

  /**
   * Search for classes and employees
   * @param  {string}  query  The search to query for
   * @param  {string}  termId The termId to look within
   * @param  {integer} min    The index of first document to retreive
   * @param  {integer} max    The index of last document to retreive
   */
  async search(query, termId, min, max, searchFields) {
    const searchOutput = await client.search({
      index: `${this.CLASS_INDEX}`,
      from: min,
      size: max - min,
      body: {
        sort: [
          '_score',
          { 'class.classId.keyword': { order: 'asc', unmapped_type: 'keyword' } }, // Use lower classId has tiebreaker after relevance
        ],
        query: {
          bool: {
            must: {
              multi_match: {
                query: query,
                type: 'most_fields', // More fields match => higher score
                fields: searchFields,
              },
            },
            filter: {
              bool: {
                should: [
                  { term: { 'class.termId': termId } },
                  { term: { type: 'employee' } },
                ],
              },
            },
          },
        },
      },
    });

    return {
      searchContent: searchOutput.body.hits.hits.map((hit) => { return { ...hit._source, score: hit._score }; }),
      resultCount: searchOutput.body.hits.total.value,
      took: searchOutput.body.took,
    };
  }

  async termSuggest(query, field) {
    const theJson = {
      index: `${this.CLASS_INDEX}`,
      body: {
        text: query,
        termSuggest: {
          term: {
            field: field,
            min_word_length: 2,
          },
        },
      },
    };

    console.log(JSON.stringify(theJson));
      
    const results = await client.search(theJson);

    return results.body.suggest.termSuggest;
  }

  // there MUST be an index on searchField.suggestion for this to work.
  async phraseSuggest(query, searchField) {
    const suggestField = `${searchField}.suggestions`;
    const results = await client.search({
      index: `${this.CLASS_INDEX}`,
      body: {
        suggest: {
          text: query,
          phraseSuggest: {
            phrase: {
              field: suggestField,
              confidence: 1.0, // only return suggestions which score better than the search itself does
              collate: {
                query: {
                  source: {
                    match: {
                      '{{field_name}}': '{{suggestion}}', // only return results that appear in the index
                    },
                  },
                },
                params: { field_name: searchField },
                prune: true,
              },
              direct_generator: [ // for adding rules and configuring how suggestions are generated
                {
                  field: suggestField,
                  prefix_length: 2, // the first two characters of the query and the suggestion must match exactly
                },
              ],
            },
          },
        },
      },
    });

    return results.body.suggest.phraseSuggest; 
  }
}

const instance = new Elastic();
export default instance;
